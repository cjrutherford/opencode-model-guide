import { loadCorpus } from "./corpus";
import { verifyCorpus } from "./verifyCorpus";

const corpus = loadCorpus();
const result = await verifyCorpus(corpus);

for (const task of result.tasks) {
  console.log(
    `${task.ok ? "PASS" : "FAIL"} ${task.id} ` +
      `[public: ${task.publicBaseline.status}, ` +
      `hidden: ${task.hiddenBaseline.status}, ` +
      `solution: ${task.solution.status}]`,
  );

  if (!task.ok) {
    for (const [label, check] of [
      ["public", task.publicBaseline],
      ["hidden", task.hiddenBaseline],
      ["solution", task.solution],
    ] as const) {
      if (check.status === "fail") {
        console.error(`  ${label}: ${check.note}`);
        if (check.output) {
          console.error(check.output.split("\n").slice(-20).join("\n"));
        }
      }
    }
  }
}

if (!result.ok) {
  process.exitCode = 1;
}
