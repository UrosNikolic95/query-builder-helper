import { EntityMetadata, Repository, SelectQueryBuilder } from "typeorm";

type Flatten<T> = T2<T1<T>>;
type T1<T> = T extends Array<infer V> ? T1<V> : T;
type T2<T> = T extends Object
  ? {
      [key in keyof T]?: T2<T1<T[key]>> | Operator<T2<T1<T[key]>>>;
    }
  : T;

interface NodeData {
  previousNode?: NodeData;
  currentValue: any;
  currentPath: string[];
  alias?: string;
  field?: string;
  isRelation?: boolean;
  isColumn?: boolean;
  isRoot?: boolean;
  entityMetadata?: EntityMetadata;
  functionData: FunctionData;
  skip?: number;
  take?: number;
}

interface FunctionData {
  queryBuilderHelper: QuerySelectBuilderHelper<any>;
  operator: "AND" | "OR";
  joinCondition: boolean;
  joinType: "left" | "inner";
  condition: string[];
}

export class Operator<T> {
  constructor(
    readonly value: T,
    readonly func: (fieldAlias: string, variableName: string) => string
  ) {}

  static ILike(val: string) {
    return new Operator(val, (a, vn) => `${a} ilike :${vn}`);
  }

  static In(val: any[]) {
    return new Operator(val, (a, vn) => `${a} in (:...${vn})`);
  }

  static IsNull() {
    return new Operator(null, (a, vn) => `${a} is null`);
  }

  static IsNotNull() {
    return new Operator(null, (a, vn) => `${a} is not null`);
  }

  static GreaterThan(val: any) {
    return new Operator(val, (a, vn) => `${a} > :${vn}`);
  }

  static GreaterThanOrEqualTo(val: any) {
    return new Operator(val, (a, vn) => `${a} >= :${vn}`);
  }

  static LessThan(val: any) {
    return new Operator(val, (a, vn) => `${a} < :${vn}`);
  }

  static LessThanOrEqualTo(val: any) {
    return new Operator(val, (a, vn) => `${a} <= :${vn}`);
  }
}

class NodeHelper implements NodeData {
  previousNode?: NodeData;
  currentValue: any;
  currentPath: string[];
  alias?: string;
  field?: string;
  isRelation?: boolean;
  isColumn?: boolean;
  isRoot?: boolean;
  entityMetadata?: EntityMetadata;
  functionData: FunctionData;

  constructor(nodeData: NodeData) {
    Object.assign(this, nodeData);
    this.alias =
      !nodeData.alias && (this.isRelation || this.isRoot)
        ? nodeData.functionData.queryBuilderHelper.getAlias(
            nodeData.currentPath,
            this.entityMetadata.tableName
          )
        : null;
  }

  getNext(field: string) {
    return new NodeHelper({
      previousNode: this,
      field,
      entityMetadata: this.entityMetadata?.relations?.find(
        (el) => el.propertyName == field
      )?.inverseEntityMetadata,
      isColumn: Boolean(
        this.entityMetadata?.columns?.find((el) => el.propertyName == field)
      ),
      isRelation: Boolean(
        this.entityMetadata?.relations?.find((el) => el.propertyName == field)
      ),
      currentValue: this.currentValue[field],
      currentPath: [...this.currentPath, field],
      functionData: this.functionData,
    });
  }

  getNewVariableName() {
    return this.functionData.queryBuilderHelper.getNewVariableName();
  }

  get keys() {
    return Object.keys(this.currentValue);
  }

  get variables() {
    return this.functionData.queryBuilderHelper.variables;
  }

  get associations() {
    return this.functionData.queryBuilderHelper.associations;
  }

  addJoin() {
    if (!this.associations[this.alias]) {
      this.associations[this.alias] = {
        association: `${this.previousNode.alias}.${this.field}`,
        alias: this.alias,
        joinType: this.functionData.joinType,
        conditions: [],
      };
    }
  }

  addJoinConditions(joinConditions: string[]) {
    const filteredJoinConditions = joinConditions?.filter((el) => el);
    if (filteredJoinConditions?.length && this.functionData.joinCondition) {
      if (filteredJoinConditions.length > 1) {
        this.associations[this.alias].conditions.push(
          "(" +
            filteredJoinConditions.join(
              " " + this.functionData.operator + " "
            ) +
            ")"
        );
      } else if (filteredJoinConditions.length == 1) {
        this.associations[this.alias].conditions.push(
          ...filteredJoinConditions
        );
      }
    }
  }

  addCondition() {
    if (!this.currentValue) return null;
    const variableName = this.getNewVariableName();
    const alias = `${this.previousNode.alias}.${this.field}`;
    if (this.currentValue instanceof Operator) {
      this.variables[variableName] = this.currentValue?.value;
      const cond = this.currentValue.func(alias, variableName);
      if (!this.functionData?.joinCondition)
        this.functionData.condition.push(cond);
      return cond;
    } else {
      this.variables[variableName] = this.currentValue;
      const cond = `${alias} = :${variableName}`;
      if (!this.functionData?.joinCondition)
        this.functionData.condition.push(cond);
      return cond;
    }
  }
}

const rootLabel = "root";

export class QuerySelectBuilderHelper<T extends Object> {
  aliases: {
    [key: string]: string;
  } = {};
  variables: {
    [key: string]: any;
  } = {};
  associations: {
    [alias: string]: {
      joinType: string;
      association?: string;
      alias?: string;
      conditions?: string[];
    };
  } = {};
  variableCounter: number = 0;
  aliasCounter: number = 0;
  conditions: string[] = [];
  exclude_val: QuerySelectBuilderHelper<T> = null;
  skipField?: number;
  takeField?: number;
  pageField?: number;

  get exclude() {
    if (!this.exclude_val) {
      this.exclude_val = new QuerySelectBuilderHelper(this.repo);
    }
    return this.exclude_val;
  }

  constructor(readonly repo: Repository<T>) {}

  getNewVariableName() {
    return "v" + this.variableCounter++;
  }
  getNewAlias(tableName?: string) {
    return [tableName, "alias", (this.aliasCounter++).toString()]
      .filter((el) => el)
      .join("_");
  }
  getAlias(path: string[], tableName: string) {
    const key = path.join(".");
    if (!this.aliases[key]) this.aliases[key] = this.getNewAlias(tableName);
    return this.aliases[key];
  }

  skip(num: number) {
    this.skipField = num;
  }

  take(num: number) {
    this.takeField = num;
    this.setSkip();
  }

  private setSkip() {
    if (this.takeField && this.pageField)
      this.skipField = (this.pageField - 1) * this.takeField;
  }

  page(num: number) {
    this.pageField = num;
    this.setSkip();
  }

  addAnd(conditions: Flatten<T>) {
    const conditionsStr: string[] = [];
    this.addConditionsRecursively(
      new NodeHelper({
        currentValue: conditions,
        currentPath: [rootLabel],
        entityMetadata: this.repo.metadata,
        isRoot: true,
        functionData: {
          queryBuilderHelper: this,
          operator: "AND",
          joinCondition: false,
          joinType: "left",
          condition: conditionsStr,
        },
      })
    );
    this.conditions.push("(" + conditionsStr.join(" AND ") + ")");
  }

  addLeftJoinAnd(conditions: Flatten<T>) {
    const conditionsStr: string[] = [];
    this.addConditionsRecursively(
      new NodeHelper({
        currentValue: conditions,
        currentPath: [rootLabel],
        entityMetadata: this.repo.metadata,
        isRoot: true,
        functionData: {
          queryBuilderHelper: this,
          operator: "AND",
          joinCondition: true,
          joinType: "left",
          condition: conditionsStr,
        },
      })
    );
    if (conditionsStr?.length)
      this.conditions.push("(" + conditionsStr.join(" AND ") + ")");
  }

  addOr(conditions: Flatten<T>) {
    const conditionsStr: string[] = [];
    this.addConditionsRecursively(
      new NodeHelper({
        currentValue: conditions,
        currentPath: [rootLabel],
        entityMetadata: this.repo.metadata,
        functionData: {
          queryBuilderHelper: this,
          operator: "OR",
          joinCondition: false,
          joinType: "left",
          condition: conditionsStr,
        },
      })
    );
    this.conditions.push("(" + conditionsStr.join(" OR ") + ")");
  }

  addExclude(conditions: Flatten<T>) {
    this.exclude.addAnd(conditions);
  }

  addConditionsRecursively(currentNode: NodeHelper) {
    return currentNode.keys.map((field) => {
      const nextNode = currentNode.getNext(field);
      if (nextNode.isRelation) {
        nextNode.addJoin();
        const joinConditions = this.addConditionsRecursively(nextNode);
        nextNode.addJoinConditions(joinConditions);
      } else {
        return nextNode.addCondition();
      }
    });
  }

  get primaryColumns() {
    return this.repo.metadata.columns.filter((el) => el.isPrimary);
  }

  fillExclude(qb: SelectQueryBuilder<T>, rootAlias: string) {
    if (!this.exclude_val) return;
    qb.leftJoin(
      (qb: SelectQueryBuilder<any>) => {
        const rootAlias = this.exclude.getAlias(
          [rootLabel],
          this.repo.metadata.tableName
        );
        const qb2 = qb.from(this.repo.target, rootAlias);
        const helper = this.exclude.fillQueryBuilder(qb2);
        helper.select(
          this.primaryColumns
            .map(
              (el) => `${rootAlias}.${el.propertyName}  as ${el.propertyName}`
            )
            .join(", ")
        );
        this.primaryColumns.forEach((el) => {
          helper.addGroupBy(`${rootAlias}.${el.propertyName}`);
        });
        return helper;
      },
      "exclude",
      this.primaryColumns
        .map(
          (el) => `exclude.${el.propertyName} = ${rootAlias}.${el.propertyName}`
        )
        .join(" and ")
    );
    qb.andWhere(
      "(" +
        this.repo.metadata.columns
          .filter((el) => el.isPrimary)
          .map((el) => `exclude.${el.propertyName} is null`)
          .join(" and ") +
        ")"
    );
  }

  getQueryBuilder() {
    const rootAlias = this.getAlias([rootLabel], this.repo.metadata.tableName);
    const qb = this.repo.createQueryBuilder(rootAlias);
    this.fillQueryBuilder(qb);
    this.fillExclude(qb, rootAlias);
    if (this.skipField) return qb.skip(this.skipField);
    if (this.takeField) return qb.take(this.takeField);
  }

  getMany() {
    const qb = this.getQueryBuilder();
    return qb.getMany();
  }

  getManyAndCount() {
    const qb = this.getQueryBuilder();
    return qb.getManyAndCount();
  }

  async getPaginated() {
    const [items, count] = await this.getManyAndCount();
    return {
      count,
      limit: this.takeField,
      page: this.pageField,
      items,
    };
  }

  fillQueryBuilder(qb: SelectQueryBuilder<T>) {
    Object.values(this.associations).forEach((associaation) => {
      if (associaation.joinType == "left") {
        if (associaation.conditions.length) {
          qb.leftJoinAndSelect(
            associaation.association,
            associaation.alias,
            associaation.conditions.join(" OR ")
          );
        } else {
          qb.leftJoinAndSelect(associaation.association, associaation.alias);
        }
      } else if (associaation.joinType == "inner") {
        if (associaation.conditions.length) {
          qb.innerJoinAndSelect(
            associaation.association,
            associaation.alias,
            associaation.conditions.join(" OR ")
          );
        } else {
          qb.innerJoinAndSelect(associaation.association, associaation.alias);
        }
      }
    });
    this.conditions.forEach((el) => {
      qb.andWhere(el);
    });
    qb.setParameters(this.variables);
    return qb;
  }
}
