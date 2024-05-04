import { EntityMetadata, Repository, SelectQueryBuilder } from "typeorm";

type Flatten<T> = T2<T1<T>>;
type T1<T> = T extends Array<infer V> ? T1<V> : T;
type T2<T> = {
  [key in keyof T]?: T2<T1<T[key]>> | Operator<T2<T1<T[key]>>>;
};

interface NodeData {
  previousNode?: NodeData;
  currentValue?: any;
  currentPath: string[];
  alias?: string;
  field?: string;
  isRelation?: boolean;
  isColumn?: boolean;
  isRoot?: boolean;
  entityMetadata?: EntityMetadata;
  functionData?: FunctionData;
  skip?: number;
  take?: number;
}

interface FunctionData {
  queryBuilderHelper: QuerySelectBuilderHelper<any>;
  operator: "AND" | "OR";
  joinCondition: boolean;
  joinType: "left" | "inner";
  conditionsWhere?: string[];
  conditionsJoin?: {
    [alias: string]: string[];
  };
}

export class Operator<T> {
  constructor(
    readonly value: T,
    readonly stringMaker: (fieldAlias: string, variableName: string) => string
  ) {}

  static Equals(val: any) {
    return new Operator(val, (a, vn) => `${a} = :${vn}`);
  }

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
  currentValue?: any;
  currentPath: string[];
  alias?: string;
  fieldAlias?: string;
  field?: string;
  isRelation?: boolean;
  isColumn?: boolean;
  isRoot?: boolean;
  entityMetadata?: EntityMetadata;
  functionData: FunctionData;

  constructor(nodeData: NodeData) {
    Object.assign(this, nodeData);
    this.alias =
      !this.alias && (this.isRelation || this.isRoot)
        ? nodeData.functionData.queryBuilderHelper.getAlias(
            nodeData.currentPath,
            this.entityMetadata.tableName
          )
        : null;
    this.fieldAlias =
      !this.fieldAlias && this.previousNode?.alias && this.field
        ? `${this.previousNode?.alias}.${this.field}`
        : null;
  }

  static getRoot(data: {
    queryBuilderHelper: QuerySelectBuilderHelper<any>;
    currentValue?: any;
    operator?: "AND" | "OR";
    joinType?: "left" | "inner";
    joinCondition?: boolean;
  }) {
    return new NodeHelper({
      currentValue: data.currentValue,
      currentPath: [rootLabel],
      entityMetadata: data.queryBuilderHelper.repo.metadata,
      isRoot: true,
      functionData: {
        queryBuilderHelper: data.queryBuilderHelper,
        operator: data?.operator,
        joinCondition: data?.joinCondition,
        joinType: data?.joinType,
        conditionsWhere: [],
        conditionsJoin: {},
      },
    });
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
      currentValue: this.currentValue?.[field],
      currentPath: [...this.currentPath, field],
      functionData: this.functionData,
    });
  }

  getNewVariableName() {
    return this.functionData.queryBuilderHelper.variableHelper.getNewVariableName();
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
        association: this.fieldAlias,
        alias: this.alias,
        joinType: this.functionData.joinType,
        conditions: [],
      };
    }
  }

  addJoinConditions() {
    Object.keys(this.functionData.conditionsJoin).forEach((alias) => {
      const strArr = this.functionData.conditionsJoin[alias];
      if (strArr?.length && this.functionData.joinCondition) {
        if (strArr.length > 1) {
          this.associations[alias].conditions.push(
            "(" + strArr.join(" " + this.functionData.operator + " ") + ")"
          );
        } else if (strArr.length == 1) {
          this.associations[alias].conditions.push(...strArr);
        }
      }
    });
  }

  getOperator(currentValue: any) {
    if (currentValue instanceof Operator) return currentValue;
    return Operator.Equals(currentValue);
  }

  addCondition() {
    if (!this.currentValue) return null;
    if (!this.functionData?.joinCondition)
      return this.addWhereCondition(this.currentValue);
    return this.addJoinCondition(this.currentValue);
  }

  getCondition(val: any) {
    if (!val) return null;
    const variableName = this.getNewVariableName();
    const op = this.getOperator(val);
    this.variables[variableName] = op?.value;
    return op.stringMaker(this.fieldAlias, variableName);
  }

  addWhereCondition(val: any) {
    const cond = this.getCondition(val);
    if (!cond) return null;
    this.functionData.conditionsWhere.push(cond);
  }

  addJoinCondition(val: any) {
    if (!this.previousNode) return;
    const cond = this.getCondition(val);
    if (!cond) return null;
    if (!this.functionData.conditionsJoin[this.previousNode.alias])
      this.functionData.conditionsJoin[this.previousNode.alias] = [];
    this.functionData.conditionsJoin[this.previousNode.alias].push(cond);
  }

  getConditions() {
    return (
      "(" +
      this.functionData.conditionsWhere.join(
        " " + this.functionData.operator + " "
      ) +
      ")"
    );
  }
}

const rootLabel = "root";

function getPath<T>(get: (el: T) => any) {
  const str: string[] = [];
  const proxy = new Proxy({} as any, {
    get(obj, property: string, context) {
      str.push(property);
      return context;
    },
  });
  get(proxy);
  return str;
}

// sub query has to share with original query
class VariableHelper {
  variables: {
    [key: string]: any;
  } = {};
  variableCounter: number = 0;
  getNewVariableName() {
    const i = this.variableCounter++;
    return "v" + i;
  }
}

export class QuerySelectBuilderHelper<T extends Object> {
  variableHelper = new VariableHelper();
  aliases: {
    [key: string]: string;
  } = {};
  get variables() {
    return this.variableHelper.variables;
  }
  associations: {
    [alias: string]: {
      joinType: string;
      association?: string;
      alias?: string;
      conditions?: string[];
    };
  } = {};
  get variableCounter() {
    return this.variableHelper.variableCounter;
  }
  aliasCounter: number = 0;
  conditions: string[] = [];
  exclude_val: QuerySelectBuilderHelper<T> = null;
  skipField?: number;
  offsetField?: number;
  takeField?: number;
  limitField?: number;
  pageField?: number;
  order: {
    alias: string;
    order?: "ASC" | "DESC";
    nulls?: "NULLS FIRST" | "NULLS LAST";
  }[] = [];

  get exclude() {
    if (!this.exclude_val) {
      this.exclude_val = new QuerySelectBuilderHelper(this.repo);
      this.exclude_val.variableHelper = this.variableHelper;
    }
    return this.exclude_val;
  }

  constructor(readonly repo: Repository<T>) {}

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

  offset(num: number) {
    this.offsetField = num;
  }

  skip(num: number) {
    this.skipField = num;
  }

  limit(num: number) {
    this.limitField = num;
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
    const root = NodeHelper.getRoot({
      currentValue: conditions,
      queryBuilderHelper: this,
      operator: "AND",
      joinType: "left",
      joinCondition: false,
    });
    this.addConditionsRecursively(root);
    root.addJoinConditions();
    if (root?.functionData?.conditionsWhere?.length)
      this.conditions.push(root.getConditions());
  }

  addLeftJoinAnd(conditions: Flatten<T>) {
    const root = NodeHelper.getRoot({
      currentValue: conditions,
      queryBuilderHelper: this,
      operator: "AND",
      joinType: "left",
      joinCondition: true,
    });
    this.addConditionsRecursively(root);
    root.addJoinConditions();
    if (root?.functionData?.conditionsWhere?.length)
      this.conditions.push(root.getConditions());
  }

  addOr(conditions: Flatten<T>) {
    const root = NodeHelper.getRoot({
      currentValue: conditions,
      queryBuilderHelper: this,
      operator: "OR",
      joinType: "left",
      joinCondition: false,
    });
    this.addConditionsRecursively(root);
    root.addJoinConditions();
    if (root?.functionData?.conditionsWhere?.length)
      this.conditions.push(root.getConditions());
  }

  addConditionsRecursively(currentNode: NodeHelper) {
    return currentNode.keys.map((field) => {
      const nextNode = currentNode.getNext(field);
      if (nextNode.isRelation) {
        nextNode.addJoin();
        this.addConditionsRecursively(nextNode);
      } else {
        nextNode.addCondition();
      }
    });
  }

  get primaryColumns() {
    return this.repo.metadata.columns.filter((el) => el.isPrimary);
  }

  primaryKeyIsNull(table: string) {
    return (
      "(" +
      this.primaryColumns
        .map((el) => `${table}.${el.propertyName} is null`)
        .join(" and ") +
      ")"
    );
  }

  joinByPrimaryKey(tableA: string, tableB: string) {
    return this.primaryColumns
      .map(
        (el) => `${tableA}.${el.propertyName} = ${tableB}.${el.propertyName}`
      )
      .join(" and ");
  }

  selectPrimaryKey(rootAlias: string) {
    return this.primaryColumns
      .map((el) => `${rootAlias}.${el.propertyName}  as ${el.propertyName}`)
      .join(", ");
  }

  groupByPrimaryKey(rootAlias: string) {
    return this.primaryColumns
      .map((el) => {
        return `${rootAlias}.${el.propertyName}`;
      })
      .join(", ");
  }

  getRootAlias() {
    return this.getAlias([rootLabel], this.repo.metadata.tableName);
  }

  fillExclude(qb: SelectQueryBuilder<T>, rootAlias: string) {
    if (!this.exclude_val) return;
    const excludedAlias = `excluded`;
    qb.leftJoin(
      (qb: SelectQueryBuilder<any>) => {
        const rootAliasSubQuery = this.exclude.getRootAlias();
        const qb2 = qb.from(this.repo.target, rootAliasSubQuery);
        const helper = this.exclude.fillQueryBuilder(qb2);
        helper.select(this.selectPrimaryKey(rootAliasSubQuery)); // remove previous select
        helper.groupBy(this.groupByPrimaryKey(rootAliasSubQuery));
        return helper;
      },
      excludedAlias,
      this.joinByPrimaryKey(excludedAlias, rootAlias)
    );
    qb.andWhere(this.primaryKeyIsNull(excludedAlias));
  }

  getQueryBuilder() {
    const rootAlias = this.getRootAlias();
    const qb = this.repo.createQueryBuilder(rootAlias);
    this.fillExclude(qb, rootAlias);
    this.fillQueryBuilder(qb);
    if (this.skipField) return qb.skip(this.skipField);
    if (this.offsetField) return qb.offset(this.offsetField);
    if (this.takeField) return qb.take(this.takeField);
    if (this.limitField) return qb.limit(this.limitField);
    return qb;
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
    this.order.forEach((el) => {
      qb.addOrderBy(el.alias, el.order, el.nulls);
    });
    qb.setParameters(this.variables);
    return qb;
  }

  returnLast<T>(root: NodeHelper, get: (el: T) => any) {
    const path = getPath(get);
    let node = root;
    path.forEach((field) => {
      node = node.getNext(field);
      if (node.isRelation) node.addJoin();
    });
    return node;
  }

  addOrderBy(
    data: {
      path: (el: T) => any;
      order?: "ASC" | "DESC";
      nulls?: "NULLS FIRST" | "NULLS LAST";
    }[]
  ) {
    const root = NodeHelper.getRoot({
      queryBuilderHelper: this,
    });
    this.order = data.map((order) => {
      let node = this.returnLast(root, order.path);
      return {
        alias: node.fieldAlias,
        order: order?.order,
        nulls: order?.nulls,
      };
    });
  }

  getUpdateQuery(data: Partial<T>): [string, any[]] {
    const tableName = this.repo.metadata.tableName;
    const columsMeta = Object.keys(data)
      .map((key) =>
        this.repo.metadata.columns.find((column) => column.propertyName == key)
      )
      .filter((columnMetadata) => columnMetadata);
    const columns = columsMeta.map(
      (columnMetadata) => columnMetadata?.databaseName
    );
    const rootAlias = this.getRootAlias();
    const updateColumns = columns.map(
      (column) => `${rootAlias}.${column} as ${column}`
    );
    const updateAlias = "update_table";
    const fromAlias = "selected_table";
    const [query, params] = this.getQueryBuilder()
      .select(this.selectPrimaryKey(this.getRootAlias()))
      .addSelect(updateColumns)
      .getQueryAndParameters();
    const setStr = columsMeta
      .map((meta, i) => `${meta?.databaseName} = $${params.length + 1 + i}`)
      .join(", ");
    const setParams = columsMeta.map((meta) => data?.[meta.propertyName]);
    const whereStr = this.joinByPrimaryKey(updateAlias, fromAlias);
    return [
      `UPDATE ${tableName} as ${updateAlias}
      SET ${setStr}
      FROM (${query}) as ${fromAlias}
      WHERE ${whereStr}`,
      [...params, ...setParams],
    ];
  }

  update(data: Partial<T>) {
    return this.repo.query(...this.getUpdateQuery(data));
  }
}
