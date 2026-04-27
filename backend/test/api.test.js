const test = require("node:test");
const assert = require("node:assert/strict");
const request = require("supertest");
const { initDb } = require("../src/services/db");
const app = require("../src/app");

test("health endpoint returns ok", async () => {
  await initDb();
  const response = await request(app).get("/api/health");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.ok, true);
});

test("project can be created", async () => {
  const response = await request(app).post("/api/projects").send({ name: "Test" });
  assert.equal(response.statusCode, 201);
  assert.equal(typeof response.body.id, "string");
  assert.equal(response.body.name, "Test");
});
