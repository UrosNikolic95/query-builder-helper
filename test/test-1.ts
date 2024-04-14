import { DataSource } from "typeorm";
import { QuerySelectBuilderHelper } from "../src/query-select-builder.helper";
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
      field: "v1",
    },
  });

  const data = await qb.getMany();

  console.log(qb.getQueryBuilder().getQuery());

  console.log(data);

  await dataSource.destroy();
}
main();
