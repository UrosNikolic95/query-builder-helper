import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  OneToMany,
  BaseEntity,
} from "typeorm";
import { Test1Entity } from "./test-1.entity";
import { Test3Entity } from "./test-3.entity";

@Entity({
  name: "test_2",
})
export class Test2Entity extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  field: string;

  @OneToMany(() => Test1Entity, (el) => el.test_2)
  test_1: Test1Entity[];

  @OneToMany(() => Test3Entity, (el) => el.test_2)
  test_3: Test3Entity[];
}
