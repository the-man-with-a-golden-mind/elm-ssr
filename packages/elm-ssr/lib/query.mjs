import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { resolve, dirname, basename } from "node:path";

const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1);

const snakeToCamel = (str) => {
  return str.replace(/_([a-z])/g, (g) => g[1].toUpperCase());
};

const singularize = (str) => {
  if (str.endsWith("ies")) return str.slice(0, -3) + "y";
  if (str.endsWith("es") && (str.endsWith("shes") || str.endsWith("ches") || str.endsWith("xes"))) return str.slice(0, -2);
  if (str.endsWith("s") && !str.endsWith("ss")) return str.slice(0, -1);
  return str;
};

const scanCreateTables = (sqlText) => {
  const tables = [];
  // Case-insensitive match for CREATE TABLE table_name (
  const regex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)\s*\(/gi;
  let match;
  
  while ((match = regex.exec(sqlText)) !== null) {
    const tableName = match[1];
    const startIndex = regex.lastIndex; // index after the opening '('
    let parenDepth = 1;
    let endIndex = -1;
    
    for (let i = startIndex; i < sqlText.length; i++) {
      const char = sqlText[i];
      if (char === "(") parenDepth++;
      if (char === ")") parenDepth--;
      if (parenDepth === 0) {
        endIndex = i;
        break;
      }
    }
    
    if (endIndex !== -1) {
      const body = sqlText.slice(startIndex, endIndex);
      tables.push({ name: tableName, body });
      regex.lastIndex = endIndex + 1;
    }
  }
  return tables;
};

const splitColumns = (body) => {
  const cols = [];
  let current = "";
  let parenDepth = 0;
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char === "(") parenDepth++;
    if (char === ")") parenDepth--;
    if (char === "," && parenDepth === 0) {
      cols.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) {
    cols.push(current.trim());
  }
  return cols;
};

const mapSqlTypeToElm = (sqlType) => {
  switch (sqlType) {
    case "INT":
    case "INTEGER":
    case "SERIAL":
    case "BIGINT":
    case "SMALLINT":
    case "TINYINT":
      return "Int";
    case "REAL":
    case "FLOAT":
    case "DOUBLE":
    case "DECIMAL":
    case "NUMERIC":
      return "Float";
    case "BOOLEAN":
    case "BOOL":
      return "Bool";
    case "TEXT":
    case "VARCHAR":
    case "CHAR":
    case "UUID":
    case "TIMESTAMP":
    case "DATE":
    case "TIME":
      return "String";
    default:
      console.warn(`[elm-ssr query] Unknown SQL type "${sqlType}", falling back to String.`);
      return "String";
  }
};

const parseColumnDefinition = (colStr) => {
  const trimmed = colStr.replace(/\s+/g, " ").trim();
  
  // Skip constraints
  if (/^(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CONSTRAINT|CHECK)\b/i.test(trimmed)) {
    return null;
  }
  
  const tokens = trimmed.split(" ");
  if (tokens.length < 2) return null;
  
  const rawName = tokens[0];
  const dbName = rawName.replace(/[`"]/g, "");
  const elmName = snakeToCamel(dbName);
  
  const rawType = tokens[1].replace(/\([\s\S]*?\)/g, "").toUpperCase();
  const elmType = mapSqlTypeToElm(rawType);
  
  const isPrimaryKey = /\bPRIMARY\s+KEY\b/i.test(trimmed);
  const isNullable = !/\bNOT\s+NULL\b/i.test(trimmed) && !isPrimaryKey;
  const hasDefault = /\bDEFAULT\b/i.test(trimmed);
  
  const isAutoIncrement = /\bAUTOINCREMENT\b/i.test(trimmed) || 
                          (isPrimaryKey && (rawType === "INTEGER" || rawType === "INT")) ||
                          rawType === "SERIAL";
                          
  return {
    dbName,
    elmName,
    elmType,
    isNullable,
    isPrimaryKey,
    hasDefault,
    isAutoIncrement
  };
};

const getFieldDecoder = (c) => {
  let baseDec = "";
  if (c.elmType === "Int") baseDec = "Decode.int";
  else if (c.elmType === "Float") baseDec = "Decode.float";
  else if (c.elmType === "Bool") baseDec = "boolDecoder";
  else baseDec = "Decode.string";
  
  if (c.isNullable) {
    return `(Decode.field "${c.dbName}" (Decode.nullable ${baseDec}))`;
  } else {
    return `(Decode.field "${c.dbName}" ${baseDec})`;
  }
};

const getEncoderExpr = (c, valName) => {
  let baseEnc = "";
  if (c.elmType === "Int") baseEnc = "Encode.int";
  else if (c.elmType === "Float") baseEnc = "Encode.float";
  else if (c.elmType === "Bool") baseEnc = "Encode.bool";
  else baseEnc = "Encode.string";
  
  if (c.isNullable) {
    return `encodeNullable ${baseEnc} ${valName}`;
  } else {
    return `${baseEnc} ${valName}`;
  }
};

const generatePipelineDecoder = (recordName, columns) => {
  let code = "";
  let indent = "";
  for (let i = 0; i < columns.length; i++) {
    const c = columns[i];
    const dec = getFieldDecoder(c);
    code += `${indent}${dec}\n${indent}        |> Decode.andThen (\\${c.elmName} ->\n`;
    indent += "    ";
  }
  
  const fieldsAssignment = columns.map(c => `${c.elmName} = ${c.elmName}`).join(", ");
  code += `${indent}Decode.succeed { ${fieldsAssignment} }\n`;
  
  for (let i = 0; i < columns.length; i++) {
    code += `)`;
  }
  return code;
};

const getDslEncoder = (elmType) => {
  if (elmType === "Int") return "Encode.int";
  if (elmType === "Float") return "Encode.float";
  if (elmType === "Bool") return "Encode.bool";
  return "Encode.string";
};

const generateElmModule = (namespace, table) => {
  const { moduleName, recordName, name: tableName, columns } = table;
  const pk = columns.find(c => c.isPrimaryKey);
  const hasBool = columns.some(c => c.elmType === "Bool");
  const hasNullable = columns.some(c => c.isNullable);
  
  let exports = [recordName, moduleName + "Table", "table", ...columns.map(c => c.elmName), "decoder", "all", "insert"];
  if (pk) {
    exports.push("byId", "delete", "update");
  }
  
  let code = `module ${namespace}.Db.${moduleName} exposing (${exports.join(", ")})

-- This module was automatically generated by elm-ssr query.
-- Do not edit this file manually.

import ElmSsr.Db.Dsl as Dsl exposing (Table, Column)
import Json.Decode as Decode exposing (Decoder)
import Json.Encode as Encode
import ElmSsr.Loader as Loader exposing (Loader)

type ${moduleName}Table
    = ${moduleName}Table


table : Table ${moduleName}Table
table =
    Dsl.table "${tableName}"

`;

  // Column descriptors
  for (const c of columns) {
    code += `
${c.elmName} : Column ${moduleName}Table ${c.elmType}
${c.elmName} =
    Dsl.column "${c.dbName}" ${getDslEncoder(c.elmType)}

`;
  }

  code += `\n`;

  // Type alias
  code += `type alias ${recordName} =\n    { `;
  const recordFields = columns.map(c => {
    const typeStr = c.isNullable ? `Maybe ${c.elmType}` : c.elmType;
    return `${c.elmName} : ${typeStr}`;
  });
  code += recordFields.join("\n    , ") + "\n    }\n\n";

  // Local helpers
  if (hasBool) {
    code += `boolDecoder : Decoder Bool
boolDecoder =
    Decode.oneOf
        [ Decode.bool
        , Decode.int |> Decode.map (\\val -> val /= 0)
        ]


`;
  }
  
  if (hasNullable) {
    code += `encodeNullable : (a -> Encode.Value) -> Maybe a -> Encode.Value
encodeNullable encoder maybeVal =
    case maybeVal of
        Just val ->
            encoder val

        Nothing ->
            Encode.null


`;
  }

  // Decoder
  code += `decoder : Decoder ${recordName}
decoder =
    `;
  
  if (columns.length === 1) {
    const c = columns[0];
    const fieldDec = getFieldDecoder(c);
    code += `Decode.map ${recordName}\n        (${fieldDec})\n\n`;
  } else if (columns.length <= 8) {
    code += `Decode.map${columns.length} ${recordName}\n        `;
    const fields = columns.map(c => getFieldDecoder(c));
    code += fields.join("\n        ") + "\n\n";
  } else {
    code += generatePipelineDecoder(recordName, columns) + "\n\n";
  }

  // Helpers: all
  const selectFields = columns.map(c => c.dbName).join(", ");
  code += `all : Loader (List ${recordName})
all =
    Loader.query
        { sql = "SELECT ${selectFields} FROM ${tableName}"
        , params = []
        , decoder = decoder
        }


`;

  // Helpers: byId
  if (pk) {
    const pkEncoder = getEncoderExpr(pk, pk.elmName);
    code += `byId : ${pk.elmType} -> Loader (Maybe ${recordName})
byId ${pk.elmName} =
    Loader.queryOne
        { sql = "SELECT ${selectFields} FROM ${tableName} WHERE ${pk.dbName} = ?"
        , params = [ ${pkEncoder} ]
        , decoder = decoder
        }


`;
  }

  // Helpers: insert
  const insertParams = columns.filter(c => !c.isAutoIncrement && !c.hasDefault);
  const insertSqlFields = insertParams.map(c => c.dbName).join(", ");
  const insertPlaceholders = insertParams.map(() => "?").join(", ");
  
  if (insertParams.length > 0) {
    const paramTypes = insertParams.map(c => {
      const typeStr = c.isNullable ? `Maybe ${c.elmType}` : c.elmType;
      return `${c.elmName} : ${typeStr}`;
    });
    const paramEncoders = insertParams.map(c => getEncoderExpr(c, `params.${c.elmName}`));
    const encoderLines = paramEncoders.map((e, idx) => {
      const prefix = idx === 0 ? "[ " : ", ";
      return `            ${prefix}${e}`;
    });
    
    code += `insert : { ${paramTypes.join(", ")} } -> Loader { rowsAffected : Int }
insert params =
    Loader.execute
        { sql = "INSERT INTO ${tableName} (${insertSqlFields}) VALUES (${insertPlaceholders})"
        , params =
${encoderLines.join("\n")}
            ]
        }


`;
  } else {
    code += `insert : Loader { rowsAffected : Int }
insert =
    Loader.execute
        { sql = "INSERT INTO ${tableName} DEFAULT VALUES"
        , params = []
        }


`;
  }

  // Helpers: delete
  if (pk) {
    const pkEncoder = getEncoderExpr(pk, pk.elmName);
    code += `delete : ${pk.elmType} -> Loader { rowsAffected : Int }
delete ${pk.elmName} =
    Loader.execute
        { sql = "DELETE FROM ${tableName} WHERE ${pk.dbName} = ?"
        , params = [ ${pkEncoder} ]
        }


`;
  }

  // Helpers: update
  if (pk) {
    const updateParams = columns.filter(c => !c.isPrimaryKey);
    if (updateParams.length > 0) {
      const updateTypes = updateParams.map(c => {
        const typeStr = c.isNullable ? `Maybe ${c.elmType}` : c.elmType;
        return `${c.elmName} : ${typeStr}`;
      });
      const updateSets = updateParams.map(c => `${c.dbName} = ?`).join(", ");
      const updateEncoders = updateParams.map(c => getEncoderExpr(c, `params.${c.elmName}`));
      const pkEncoder = getEncoderExpr(pk, pk.elmName);
      
      const encoderLines = [
        ...updateEncoders,
        pkEncoder
      ].map((e, idx) => {
        const prefix = idx === 0 ? "[ " : ", ";
        return `            ${prefix}${e}`;
      });
      
      code += `update : ${pk.elmType} -> { ${updateTypes.join(", ")} } -> Loader { rowsAffected : Int }
update ${pk.elmName} params =
    Loader.execute
        { sql = "UPDATE ${tableName} SET ${updateSets} WHERE ${pk.dbName} = ?"
        , params =
${encoderLines.join("\n")}
            ]
        }


`;
    }
  }

  return code;
};

export const generateQueries = async ({ rootPath, appConfig, migrationsDir, outputDir }) => {
  const resolvedMigrationsDir = migrationsDir ? resolve(rootPath, migrationsDir) : resolve(rootPath, appConfig.root, "migrations");
  const resolvedOutputDir = outputDir ? resolve(rootPath, outputDir) : resolve(rootPath, appConfig.root, "src", appConfig.module.split(".").join("/"), "Db");
  
  try {
    await stat(resolvedMigrationsDir);
  } catch {
    throw new Error(`Migrations directory not found: ${resolvedMigrationsDir}`);
  }

  const files = await readdir(resolvedMigrationsDir);
  const sqlFiles = files
    .filter(f => f.endsWith(".sql") && !f.endsWith(".down.sql"))
    .sort();

  if (sqlFiles.length === 0) {
    console.log(`[elm-ssr query] No SQL migration files found in ${resolvedMigrationsDir}`);
    return;
  }

  // Map to store tables to prevent duplicates and keep the latest definition
  const tablesMap = new Map();

  for (const file of sqlFiles) {
    const content = await readFile(resolve(resolvedMigrationsDir, file), "utf8");
    const parsedTables = scanCreateTables(content);
    
    for (const table of parsedTables) {
      const columns = splitColumns(table.body)
        .map(parseColumnDefinition)
        .filter(Boolean);
        
      if (columns.length === 0) continue;
      
      const moduleName = capitalize(snakeToCamel(table.name));
      const recordName = capitalize(singularize(snakeToCamel(table.name)));
      
      tablesMap.set(table.name, {
        name: table.name,
        moduleName,
        recordName,
        columns
      });
    }
  }

  if (tablesMap.size === 0) {
    console.log(`[elm-ssr query] No valid CREATE TABLE statements found in migrations.`);
    return;
  }

  await mkdir(resolvedOutputDir, { recursive: true });

  for (const table of tablesMap.values()) {
    const fileContent = generateElmModule(appConfig.module, table);
    const targetFile = resolve(resolvedOutputDir, `${table.moduleName}.elm`);
    await writeFile(targetFile, fileContent, "utf8");
    console.log(`[elm-ssr query] Generated Db helper at ${targetFile}`);
  }
};
