import { DataSource } from "typeorm";
import {
  Operator,
  QuerySelectBuilderHelper,
  RawQueryHelper,
} from "../src/query-select-builder.helper";
import { Test1Entity } from "./entities/test-1.entity";
import { Test2Entity } from "./entities/test-2.entity";
import { Test3Entity } from "./entities/test-3.entity";

async function main() {
  const dataSource = new DataSource({
    type: "postgres",
    url: "postgres://postgres:qwerty@localhost:5432/test-4",
    entities: [Test1Entity, Test2Entity, Test3Entity],
    synchronize: true,
  });
  await dataSource.initialize();

  //   const v2 = new Test2Entity();
  //   v2.field = "v2";
  //   await dataSource.getRepository(Test2Entity).save(v2);

  //   const v1 = new Test1Entity();
  //   v1.field = "v1";
  //   v1.test_2 = v2;
  //   await dataSource.getRepository(Test1Entity).save(v1);

  //   const v3 = new Test3Entity();
  //   v3.field = "v3";
  //   v3.test_2 = v2;
  //   await dataSource.getRepository(Test3Entity).save(v3);

  const qb = new QuerySelectBuilderHelper(
    dataSource.getRepository(Test1Entity)
  );

  qb.addLeftJoinAnd({
    test_2: {
      id: 1,
      field: "qqq",
    },
  });

  qb.exclude.addAnd({
    test_2: {
      test_1: {
        field: "abcd",
      },
    },
  });

  qb.include.addAnd({
    test_2: {
      test_1: {
        field: "abcd",
      },
    },
  });

  qb.addAnd({
    id: 20,
    test_2: {
      field: Operator.IsNull(),
    },
  });
  qb.addAnd({
    id: 22,
    test_2: {
      field: Operator.IsNotNull(),
    },
  });
  qb.addOrderBy([
    {
      path: (el) => el.test_2.id,
      order: "DESC",
    },
    {
      path: (el) => el.id,
    },
  ]);

  qb.limit(111);

  console.log(qb.variables);

  console.log("::::", qb.getQueryBuilder().getQueryAndParameters());

  const data = await qb.getMany();

  console.log(qb.getUpdateQuery({ field: "abc", test_2_id: 1 }));

  const [query, params] = qb.getUpdateQuery({ field: "abc1", test_2_id: 1 });

  await qb.repo.query(query, params);

  console.log(data);

  const d2 = new RawQueryHelper(qb.repo, {
    v0: (el) => el.id,
    v1: (el) => el.mirror.test_2.id,
  });

  console.log(d2.qb.getQueryBuilder().getQuery());
  await d2.getRawMany();

  await dataSource.destroy();
}
main();
