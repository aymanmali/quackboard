const FORBIDDEN_KEYWORDS = [
  "INSERT",
  "UPDATE",
  "DELETE",
  "DROP",
  "ALTER",
  "TRUNCATE",
  "CREATE",
  "REPLACE",
  "GRANT",
  "REVOKE",
  "MERGE",
  "CALL",
  "EXEC",
  "EXECUTE",
  "COPY",
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "VACUUM",
  "LOAD",
  "INSTALL",
];

/**
 * Strips SQL comments and string literals in a single left-to-right pass so
 * comment markers inside strings (e.g. `'--'`) and quotes inside comments
 * (e.g. `-- don't`) never interfere with each other.
 */
function stripCommentsAndStrings(sql: string): string {
  return sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\//g,
    (match) => {
      if (match.startsWith("'")) return "''";
      if (match.startsWith('"')) return '""';
      return " ";
    }
  );
}

export interface SqlValidationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Ensures ad-hoc SQL queries in SQL Lab are strictly single-statement read-only queries.
 */
export function validateReadOnlySql(rawSql: string): SqlValidationResult {
  const trimmed = rawSql.trim();
  if (!trimmed) {
    return { valid: false, reason: "SQL query cannot be empty." };
  }

  const sanitized = stripCommentsAndStrings(trimmed);

  // Disallow multi-statement queries (semicolons anywhere except a single trailing one)
  const withoutTrailingSemi = sanitized.replace(/;\s*$/, "");
  if (withoutTrailingSemi.includes(";")) {
    return {
      valid: false,
      reason: "Multiple SQL statements are not allowed. Submit a single SELECT/WITH query.",
    };
  }

  const firstTokenMatch = withoutTrailingSemi.trim().match(/^([A-Za-z_]+)/);
  const firstToken = firstTokenMatch?.[1]?.toUpperCase();
  if (!firstToken || !["SELECT", "WITH", "SHOW", "DESCRIBE", "EXPLAIN"].includes(firstToken)) {
    return {
      valid: false,
      reason: "Only read-only SELECT, WITH, SHOW, DESCRIBE, or EXPLAIN queries are permitted.",
    };
  }

  const upper = withoutTrailingSemi.toUpperCase();
  for (const keyword of FORBIDDEN_KEYWORDS) {
    const regex = new RegExp(`\\b${keyword}\\b`, "i");
    if (regex.test(upper)) {
      return {
        valid: false,
        reason: `Forbidden SQL keyword detected: ${keyword}. QuackBoard only allows read-only queries.`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a SQL identifier (table or schema name) against safe characters.
 */
export function isValidIdentifier(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_$-]{0,127}$/.test(name);
}
