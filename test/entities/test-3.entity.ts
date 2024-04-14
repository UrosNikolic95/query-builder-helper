import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  BaseEntity,
} from "typeorm";
import { Test2Entity } from "./test-2.entity";

@Entity({
  name: "test_3",
})
export class Test3Entity extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  field: string;

  @ManyToOne(() => Test2Entity, (el) => el.test_3)
  test_2: Test2Entity;
}
