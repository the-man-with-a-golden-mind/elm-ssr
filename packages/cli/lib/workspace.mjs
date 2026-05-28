import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export const configFileName = "elm-ssr.config.json";

export const readJsonFile = async (filePath) =>
  JSON.parse(await readFile(filePath, "utf8"));

export const writeJsonFile = async (filePath, value) => {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const workspaceConfigPath = (rootPath) =>
  resolve(rootPath, configFileName);

export const readWorkspaceConfig = async (rootPath) =>
  readJsonFile(workspaceConfigPath(rootPath));

export const writeWorkspaceConfig = async (rootPath, config) =>
  writeJsonFile(workspaceConfigPath(rootPath), config);
