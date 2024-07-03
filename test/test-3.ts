import "../src/query-select-builder.helper";
import { getFunctionParams } from "../src/query-select-builder.helper";

async function main() {
  const data = getFunctionParams(
    (el) =>
      el
        .abc({
          bbb: 1,
        })
        .nnn(1, 2, 3).iii
  );
  console.log(JSON.stringify(data, null, 1));
}
main();
