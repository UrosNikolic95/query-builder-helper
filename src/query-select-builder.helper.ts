import { EntityMetadata, Repository, SelectQueryBuilder } from "typeorm";

type FlattenRecursive<T> = FlattenFields<FlattenArray<T>>;
type FlattenArray<T> = T extends Array<infer V> ? FlattenArray<V> : T;
type FlattenFields<T> = {
  [key in keyof T]?: T[key] extends Date | number | boolean | string
    ? T[key] | Operator<FlattenFields<FlattenArray<T[key] | null>>>
    : FlattenFields<FlattenArray<T[key]>>;
};

type SimpleFlatten<T> = SimpleFlattenFields<FlattenArray<T>>;
type SimpleFlattenFields<T> = {
  [key in keyof T]: SimpleFlattenFields<FlattenArray<T[key]>>;
};

type FlattenAndReplace<T1, T2> = FlattenAndReplaceFields<FlattenArray<T1>, T2>;
type FlattenAndReplaceFields<T1, T2> = {
  [key in keyof T1]?: T1[key] extends Date | number | boolean | string
    ? T2
    : FlattenAndReplaceFields<FlattenArray<T1[key]>, T2>;
};

type Select<T1, T2> = {
  [P1 in keyof T1]: (el: SimpleFlatten<T2>) => T1[P1];
};

type KeysValue<KeysFrom, value> = {
  [key in keyof KeysFrom]?: value;
};

type Transform<T> = {
  groupBy: T;
  sum: T;
  count: number;
  countDistinct: KeysValue<T, number>;
};

type GroupBy<input, output> = {
  [key in keyof output]: (el: Transform<input>) => output[key];
};

interface NodeData {
  previousNode?: NodeData;
  currentValue?: any;
  currentPath: string[];
  relationAlias?: string;
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
  operator?: "AND" | "OR";
  joinCondition?: boolean;
  joinType?: "left" | "inner";
  conditionsWhere?: string[];
  conditionsJoin?: {
    [alias: string]: string[];
  };
}

export class Operator<T = any> {
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
  relationAlias?: string; // "alias"
  fieldAlias?: string; // "previous_alias.field"
  field?: string; // "field"
  isRelation?: boolean;
  isColumn?: boolean;
  isRoot?: boolean;
  entityMetadata?: EntityMetadata;
  functionData: FunctionData;

  constructor(nodeData: NodeData) {
    Object.assign(this, nodeData);
    this.getRelationAlias();
    this.getFieldAlias();
  }

  getRelationAlias() {
    if (this.relationAlias) return;
    this.relationAlias =
      this.isRelation || this.isRoot
        ? this.functionData.queryBuilderHelper.getAlias(
            this.currentPath,
            this.entityMetadata.tableName
          )
        : null;
  }

  getFieldAlias() {
    if (this.fieldAlias) return;
    this.fieldAlias =
      this.previousNode?.relationAlias && this.field
        ? `${this.previousNode?.relationAlias}.${this.field}`
        : null;
  }

  static getRoot(data: {
    queryBuilderHelper: QuerySelectBuilderHelper<any>;
    currentValue?: any;
    operator?: "AND" | "OR";
    joinType?: "left" | "inner";
    joinCondition?: boolean;
    rootLabel?: string;
  }) {
    return new NodeHelper({
      currentValue: data.currentValue,
      currentPath: [data?.rootLabel || rootLabel],
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
      isRelation: this.getIsRelation(field),
      currentValue: this.currentValue?.[field],
      currentPath: [...this.currentPath, field],
      functionData: this.functionData,
    });
  }

  getIsRelation(field: string) {
    return Boolean(
      this.entityMetadata?.relations?.find((el) => el.propertyName == field)
    );
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
    if (!this.associations[this.relationAlias]) {
      this.associations[this.relationAlias] = {
        association: this.fieldAlias,
        alias: this.relationAlias,
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
    const op = this.getOperator(val);
    if (!op?.value) return null;
    const variableName = this.getNewVariableName();
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
    if (!this.functionData.conditionsJoin[this.previousNode.relationAlias])
      this.functionData.conditionsJoin[this.previousNode.relationAlias] = [];
    this.functionData.conditionsJoin[this.previousNode.relationAlias].push(
      cond
    );
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

export function getPath<T>(get: (el: T) => any) {
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

export function getFunctionParams(get: (el: any) => any) {
  const res: {
    data: {
      field: string;
      params: any;
    }[];
  } = {
    data: [],
  };
  const proxy = new Proxy(
    (...args: any[]) => {
      res.data[res.data.length - 1].params = args;
      return proxy;
    },
    {
      get(obj, property: string, context) {
        res.data.push({
          field: property,
          params: null,
        });
        return proxy;
      },
    }
  );
  get(proxy);
  return res;
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

interface IAssociation {
  joinType: string;
  association?: string;
  alias?: string;
  select?: boolean;
  conditions?: string[];
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
    [alias: string]: IAssociation;
  } = {};
  get variableCounter() {
    return this.variableHelper.variableCounter;
  }
  aliasCounter: number = 0;
  conditions: string[] = [];
  excludeVal: QuerySelectBuilderHelper<T> = null;
  includeVal: QuerySelectBuilderHelper<T> = null;
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
  select?: { [key: string]: string } = {};
  groupBy?: string[];
  distinctOn: string[];

  get exclude() {
    if (!this.excludeVal) {
      this.excludeVal = new QuerySelectBuilderHelper(this.repo);
      this.excludeVal.variableHelper = this.variableHelper;
    }
    return this.excludeVal;
  }

  setExclude(queryBuilder: (el: QuerySelectBuilderHelper<T>) => void) {
    queryBuilder(this.exclude);
  }

  get include() {
    if (!this.includeVal) {
      this.includeVal = new QuerySelectBuilderHelper(this.repo);
      this.includeVal.variableHelper = this.variableHelper;
    }
    return this.includeVal;
  }

  setInclude(queryBuilder: (el: QuerySelectBuilderHelper<T>) => void) {
    queryBuilder(this.include);
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

  addAnd(conditions: FlattenRecursive<T>) {
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

  addLeftJoinAnd(conditions: FlattenRecursive<T>) {
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

  addOr(conditions: FlattenRecursive<T>) {
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
    if (!this.excludeVal) return;
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

  fillInclude(qb: SelectQueryBuilder<T>, rootAlias: string) {
    if (!this.includeVal) return;
    const includeAlias = `included`;
    qb.innerJoin(
      (qb: SelectQueryBuilder<any>) => {
        const rootAliasSubQuery = this.include.getRootAlias();
        const qb2 = qb.from(this.repo.target, rootAliasSubQuery);
        const helper = this.include.fillQueryBuilder(qb2);
        helper.select(this.selectPrimaryKey(rootAliasSubQuery)); // remove previous select
        helper.groupBy(this.groupByPrimaryKey(rootAliasSubQuery));
        return helper;
      },
      includeAlias,
      this.joinByPrimaryKey(includeAlias, rootAlias)
    );
  }

  fillGroupBy(qb: SelectQueryBuilder<T>) {
    if (this.groupBy)
      this.groupBy.forEach((key) => {
        qb.addGroupBy(key);
      });
  }

  getQueryBuilder() {
    const rootAlias = this.getRootAlias();
    const qb = this.repo.createQueryBuilder(rootAlias);
    this.fillExclude(qb, rootAlias);
    this.fillInclude(qb, rootAlias);
    this.fillQueryBuilder(qb);
    this.fillGroupBy(qb);
    if (this.skipField) qb.skip(this.skipField);
    if (this.offsetField) qb.offset(this.offsetField);
    if (this.takeField) qb.take(this.takeField);
    if (this.limitField) qb.limit(this.limitField);
    if (this.distinctOn) qb.distinctOn(this.distinctOn);
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

  join(qb: SelectQueryBuilder<T>, association: IAssociation) {
    const isLeftJoinType = association.joinType == "left";
    const isInnerJoinType = association.joinType == "inner";
    const hasConditions = Boolean(association.conditions.length);
    const isSelect = association.select;

    // left join and select

    if (isLeftJoinType && hasConditions && isSelect)
      return qb.leftJoinAndSelect(
        association.association,
        association.alias,
        "(" + association.conditions.join(" OR ") + ")"
      );

    if (isLeftJoinType && !hasConditions && isSelect)
      return qb.leftJoinAndSelect(association.association, association.alias);

    // left join no select

    if (isLeftJoinType && hasConditions && !isSelect)
      return qb.leftJoin(
        association.association,
        association.alias,
        "(" + association.conditions.join(" OR ") + ")"
      );

    if (isLeftJoinType && !hasConditions && !isSelect)
      return qb.leftJoin(association.association, association.alias);

    //-----------------------------------------------------------------------

    // inner join and select

    if (isInnerJoinType && hasConditions && isSelect)
      return qb.innerJoinAndSelect(
        association.association,
        association.alias,
        "(" + association.conditions.join(" OR ") + ")"
      );

    if (isInnerJoinType && !hasConditions && isSelect)
      return qb.innerJoinAndSelect(association.association, association.alias);

    // inner join no select

    if (isInnerJoinType && hasConditions && !isSelect)
      return qb.innerJoin(
        association.association,
        association.alias,
        "(" + association.conditions.join(" OR ") + ")"
      );

    if (isInnerJoinType && !hasConditions && !isSelect)
      return qb.innerJoin(association.association, association.alias);
  }

  selectString() {
    return Object.keys(this.select).map(
      (key) => `${this.select[key]} as ${key}`
    );
  }

  fillQueryBuilder(qb: SelectQueryBuilder<T>) {
    if (Object.keys(this.select).length) qb.select(this.selectString());
    Object.values(this.associations).forEach((association) => {
      this.join(qb, association);
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
      const node = this.returnLast(root, order.path);
      return {
        alias: node.fieldAlias,
        order: order?.order,
        nulls: order?.nulls,
      };
    });
  }

  rawQuery<result>(data: Select<result, T>) {
    const root = NodeHelper.getRoot({
      queryBuilderHelper: this,
      operator: "AND",
      joinType: "left",
      joinCondition: false,
    });
    Object.keys(data).forEach((key) => {
      const last = this.returnLast(root, data[key]);
      this.select[key] = last.fieldAlias;
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

export class RawQueryHelper<T, result> {
  helper: QuerySelectBuilderHelper<T> = null;
  constructor(
    readonly data: { repo: Repository<T>; select: Select<result, T> }
  ) {
    this.helper = new QuerySelectBuilderHelper(data.repo);
    this.helper.rawQuery(data.select);
  }

  where(data: {
    [key in keyof result]?: result[key] | Operator<result[key] | any>;
  }) {
    Object.keys(data).forEach((key) => {
      const val = data[key];
      const isOperator = val instanceof Operator;
      const op = isOperator ? val : Operator.Equals(val);
      const varName = this.helper.variableHelper.getNewVariableName();
      if (op.value) this.helper.variables[varName] = val;
      const cond = op.stringMaker(this.helper.select[key], varName);
      this.helper.conditions.push(cond);
    });
    return this;
  }

  whereSqlString(
    data: (el: {
      [key in keyof result]?: string;
    }) => string
  ) {
    this.helper.conditions.push(
      data(this.helper.select as { [key in keyof result]?: string })
    );
    return this;
  }

  setOrder(data: { [key in keyof result]?: "ASC" | "DESC" }) {
    this.helper.order = Object.keys(data).map((key) => ({
      alias: this.helper.select[key],
      order: data[key],
    }));
    return this;
  }

  distinctOn(data: { [key in keyof result]?: boolean }) {
    this.helper.distinctOn = Object.keys(data)
      .filter((key) => data[key])
      .map((key) => this.helper.select[key]);
    return this;
  }

  groupBy<output>(data: GroupBy<result, output>) {
    const oldSelect = this.helper.select;
    this.helper.select = {};
    this.helper.groupBy = [];
    Object.keys(data).forEach((key) => {
      const fields = getPath(data[key]);
      const f0 = fields?.[0];
      const f1 = oldSelect?.[fields?.[1]];
      if (f0 == "groupBy") {
        this.helper.select[key] = f1;
        this.helper.groupBy.push(f1);
      }
      if (f0 == "sum") this.helper.select[key] = `SUM(${f1})`;
      if (f0 == "count") this.helper.select[key] = `COUNT(*)`;
      if (f0 == "countDistinct")
        this.helper.select[key] = `COUNT(DISTINCT(${f1}))`;
    });
    return this as any as RawQueryHelper<T, output>;
  }

  getRawMany() {
    return this.helper.getQueryBuilder().getRawMany<result>();
  }
}
