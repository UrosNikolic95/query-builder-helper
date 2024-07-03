import "../src/query-select-builder.helper";
import {
  getFirstFunctionParams,
  getFunctionParams,
} from "../src/query-select-builder.helper";

async function main() {
  const data = getFunctionParams(
    (el) =>
      el
        .abc({
          bbb: 1,
        })
        .nnn(1, 2, 3).iii
  );
  console.log(data);

  const data2 = getFirstFunctionParams(
    (el) =>
      el
        .abc({
          bbb: 1,
        })
        .nnn(1, 2, 3).iii
  );
  console.log(data2);
}
main();
