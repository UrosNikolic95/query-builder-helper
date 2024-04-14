import { Repository, SelectQueryBuilder } from "typeorm";

type Flatten<T> = T2<T1<T>>;
type T1<T> = T extends Array<infer V> ? T1<V> : T;
type T2<T> = T extends Object
  ? {
      [key in keyof T]?: T2<T1<T[key]>>;
    }
  : T;

interface NodeData {
  previousNode?: NodeData;
  currentValue: any;
  currentPath: string[];
  alias?: string;
  field?: string;
  functionData: {
    queryBuilderHelper: QuerySelectBuilderHelper<any>;
    operator: "AND" | "OR";
    joinCondition: boolean;
    joinType: "left" | "inner";
    condition: string[];
  };
}

interface FunctionData {
  queryBuilderHelper: QuerySelectBuilderHelper<any>;
  operator: "AND" | "OR";
  joinCondition: boolean;
  joinType: "left" | "inner";
  condition: string[];
}

class NodeHelper implements NodeData {
  previousNode?: NodeData;
  currentValue: any;
  currentPath: string[];
  alias?: string;
  field?: string;
  functionData: FunctionData;

  get isSubObject() {
    return (
      typeof this.currentValue == "object" &&
      !(this.currentValue instanceof Date)
    );
  }

  constructor(nodeData: NodeData) {
    Object.assign(this, nodeData);
    this.alias =
      !nodeData.alias && this.isSubObject
        ? nodeData.functionData.queryBuilderHelper.getAlias(
            nodeData.currentPath
          )
        : null;
  }

  getNext(field: string) {
    return new NodeHelper({
      previousNode: this,
      field,
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
    this.variables[variableName] = this.currentValue;
    const cond = `${this.previousNode.alias}.${this.field} = :${variableName}`;
    if (!this.functionData?.joinCondition)
      this.functionData.condition.push(cond);
    return cond;
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
  getNewAlias() {
    return "a" + this.aliasCounter++;
  }
  getAlias(path: string[]) {
    const key = path.join(".");
    if (!this.aliases[key]) this.aliases[key] = this.getNewAlias();
    return this.aliases[key];
  }

  addAnd(conditions: Flatten<T>) {
    const conditionsStr: string[] = [];
    this.addConditionsRecursively(
      new NodeHelper({
        currentValue: conditions,
        currentPath: [rootLabel],
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
      if (nextNode.isSubObject) {
        nextNode.addJoin();
        const joinConditions = this.addConditionsRecursively(nextNode);
        nextNode.addJoinConditions(joinConditions);
      } else {
        return nextNode.addCondition();
      }
    });
  }

  getQueryBuilder() {
    const rootAlias = this.getAlias([rootLabel]);
    const qb = this.repo.createQueryBuilder(rootAlias);
    this.fillQueryBuilder(qb);
    return qb;
  }

  getMany() {
    const qb = this.getQueryBuilder();
    return qb.getMany();
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
