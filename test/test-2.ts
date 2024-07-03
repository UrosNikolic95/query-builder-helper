import { DataSource, SelectQueryBuilder } from "typeorm";
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

  const data = await dataSource
    .getRepository(Test1Entity)
    .createQueryBuilder("q")
    .leftJoin(
      (qr: SelectQueryBuilder<Test1Entity>) => qr.from(Test1Entity, "g"),
      "t",
      "t.id = q.id"
    )
    .getRawMany();

  console.log(data);

  await dataSource.destroy();
}
main();
