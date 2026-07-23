import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parse } from "yaml";

const workflowUrl = new URL(
  "../.github/workflows/deploy-pages.yml",
  import.meta.url,
);

const ACTIONS = {
  checkout:
    "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
  setupNode:
    "actions/setup-node@820762786026740c76f36085b0efc47a31fe5020",
  configurePages:
    "actions/configure-pages@45bfe0192ca1faeb007ade9deae92b16b8254a0d",
  uploadArtifact:
    "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
  deployPages:
    "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
};

test("Pages workflow owns the exact profiler deployment gate", async () => {
  const workflow = parse(await readFile(workflowUrl, "utf8"));

  assert.deepEqual(workflow.on, {
    push: { branches: ["main"] },
    workflow_dispatch: null,
  });
  assert.deepEqual(workflow.permissions, {});
  assert.deepEqual(workflow.concurrency, {
    group: "pages",
    "cancel-in-progress": false,
  });
  assert.deepEqual(Object.keys(workflow.jobs).sort(), ["build", "deploy"]);

  const build = workflow.jobs.build;
  const deploy = workflow.jobs.deploy;
  assert.deepEqual(build.permissions, { contents: "read" });
  assert.deepEqual(deploy.permissions, {
    pages: "write",
    "id-token": "write",
  });

  const checkout = build.steps.find(
    ({ uses }) => uses === ACTIONS.checkout,
  );
  assert.ok(checkout, "build job must use the pinned checkout action");
  assert.equal(checkout.with?.["persist-credentials"], false);

  assert.deepEqual(
    build.steps
      .filter(({ run }) => run !== undefined)
      .map(({ run }) => run),
    [
      "npm ci",
      "npm test",
      "npm run build",
      "npm audit",
      "npm run verify:pages",
    ],
  );
  assert.deepEqual(
    build.steps
      .filter(({ uses }) => uses !== undefined)
      .map(({ uses }) => uses),
    [
      ACTIONS.checkout,
      ACTIONS.setupNode,
      ACTIONS.configurePages,
      ACTIONS.uploadArtifact,
    ],
  );
  const upload = build.steps.find(
    ({ uses }) => uses === ACTIONS.uploadArtifact,
  );
  assert.equal(upload.with?.path, "dist/client");
  const configureIndex = build.steps.findIndex(
    ({ uses }) => uses === ACTIONS.configurePages,
  );
  const verifyIndex = build.steps.findIndex(
    ({ run }) => run === "npm run verify:pages",
  );
  const uploadIndex = build.steps.findIndex(
    ({ uses }) => uses === ACTIONS.uploadArtifact,
  );
  assert.ok(configureIndex < verifyIndex);
  assert.equal(uploadIndex, verifyIndex + 1);
  assert.equal(
    build.steps
      .slice(verifyIndex + 1)
      .some(({ run }) => run !== undefined),
    false,
  );

  assert.equal(deploy.needs, "build");
  assert.equal(
    deploy.if,
    "${{ github.ref == 'refs/heads/main' }}",
  );
  assert.deepEqual(deploy.environment, {
    name: "github-pages",
    url: "${{ steps.deployment.outputs.page_url }}",
  });
  assert.deepEqual(deploy.steps, [
    {
      name: "Deploy to GitHub Pages",
      id: "deployment",
      uses: ACTIONS.deployPages,
    },
  ]);

  for (const forbidden of [
    "pull_request",
    "pull_request_target",
    "repository_dispatch",
    "workflow_call",
  ]) {
    assert.equal(workflow.on[forbidden], undefined);
  }
});
