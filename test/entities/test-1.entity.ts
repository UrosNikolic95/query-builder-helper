import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  BaseEntity,
} from "typeorm";
import { Test2Entity } from "./test-2.entity";

@Entity({
  name: "test_1",
})
export class Test1Entity extends BaseEntity {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  field: string;

  @Column({ nullable: true })
  test_2_id: number;

  @ManyToOne(() => Test2Entity, (el) => el.test_1)
  test_2: Test2Entity;
}
