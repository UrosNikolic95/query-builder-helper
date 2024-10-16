import { DataSource } from "typeorm";
import { Test1Entity } from "./entities/test-1.entity";
import { Test2Entity } from "./entities/test-2.entity";
import { Test3Entity } from "./entities/test-3.entity";
import { SelectDataFactory } from "../src/query-select-builder.helper";

async function main() {
  const dataSource = new DataSource({
    type: "postgres",
    url: "postgres://postgres:qwerty@localhost:5432/test-4",
    entities: [Test1Entity, Test2Entity, Test3Entity],
    synchronize: true,
  });
  await dataSource.initialize();

  const f = new SelectDataFactory(dataSource);

  const e = f.expression({
    select: {
      t1_id: (el) => el.t1.id,
      t1_test_2_id: (el) => el.t1.val,
      t2_id: (el) => el.t2.id,
      t2_test_2_id: (el) => el.t2.test_2_id,
    },
    from: {
      t1: f.values([
        {
          id: 1,
          val: "A1",
        },
        {
          id: 2,
          val: "A2",
        },
      ]),
    },
    join: {
      t2: {
        type: "left",
        data: f.entity(Test1Entity),
        on: {
          id: (el) => el.t1.id,
        },
      },
    },
    where: (el) => `${el.t1.id} = ${el.t2.id}`,
    offset: 1,
    limit: 1,
  });

  const d = await e.getData();
  console.log(d);
  console.log(e.data.dataSql);
}
main();
