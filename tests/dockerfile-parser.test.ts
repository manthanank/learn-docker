import { describe, it, expect } from "vitest";
import { parseDockerfile, parseFromInstruction } from "../src/engine/dockerfile-parser";

describe("Dockerfile Parser & AST Engine", () => {
  it("should parse a simple single-stage Dockerfile", () => {
    const dockerfile = `
# Comment here
FROM alpine:3.18
WORKDIR /app
COPY . .
RUN npm install
CMD ["npm", "start"]
`;
    const ast = parseDockerfile(dockerfile);
    expect(ast.stages.length).toBe(1);
    expect(ast.stages[0].baseImage).toBe("alpine");
    expect(ast.stages[0].baseTag).toBe("3.18");
    expect(ast.instructions.length).toBe(5);
    expect(ast.comments.length).toBe(1);
  });

  it("should correctly identify multi-stage build targets and aliases", () => {
    const multiStage = `
FROM golang:1.21-alpine AS builder
WORKDIR /src
COPY . .
RUN go build -o /bin/app

FROM alpine:3.18 AS runner
COPY --from=builder /bin/app /bin/app
USER 1001
CMD ["/bin/app"]
`;
    const ast = parseDockerfile(multiStage);
    expect(ast.stages.length).toBe(2);
    expect(ast.stages[0].name).toBe("builder");
    expect(ast.stages[0].baseImage).toBe("golang");
    expect(ast.stages[1].name).toBe("runner");
    expect(ast.stages[1].baseImage).toBe("alpine");

    const copyFrom = ast.instructions.find((i) => i.flags["from"] === "builder");
    expect(copyFrom).toBeDefined();
    expect(copyFrom?.type).toBe("COPY");
  });

  it("should parse flags, line continuations, and JSON exec args", () => {
    const dockerfile = `
FROM --platform=linux/amd64 node:22-alpine
RUN apk update && \\
    apk add --no-cache curl git
ENTRYPOINT ["node", "--max-old-space-size=4096", "dist/main.js"]
`;
    const ast = parseDockerfile(dockerfile);
    expect(ast.stages[0].platform).toBe("linux/amd64");
    expect(ast.instructions[1].rawArgs).toContain("apk add --no-cache curl git");

    const ep = ast.instructions[2];
    expect(ep.args).toEqual(["node", "--max-old-space-size=4096", "dist/main.js"]);
  });

  it("should parse FROM instruction variations with digest", () => {
    const res = parseFromInstruction("python:3.11-slim@sha256:abcdef123456 AS pybuilder");
    expect(res.image).toBe("python");
    expect(res.tag).toBe("3.11-slim");
    expect(res.digest).toBe("sha256:abcdef123456");
    expect(res.alias).toBe("pybuilder");
  });
});
