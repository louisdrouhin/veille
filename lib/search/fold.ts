/**
 * Accent and case folding for the exact search, identical in SQL (folders_fold(), migration 0012) and here.
 * One character in, one character out: the positions of the folded text are those of the original, so the
 * server can give the client exact offsets to highlight (<mark>) without ts_headline.
 * Uppercase accented letters are listed too: Postgres lower() leaves them alone under the C locale (PGlite).
 */
export const FOLD_FROM = "ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝŸýÿŒœÆæ’‘ʼ";
export const FOLD_TO = "aaaaaaaaaaaacceeeeeeeeiiiiiiiinnoooooooooouuuuuuuuyyyyooaa'''";

const MAP = new Map([...FOLD_FROM].map((c, i) => [c, FOLD_TO[i]!]));

export function fold(s: string): string {
  let out = "";
  for (const ch of s) {
    const mapped = MAP.get(ch);
    // toLowerCase() may change the length of rare characters (İ): keep the original then.
    out += mapped ?? (ch.toLowerCase().length === ch.length ? ch.toLowerCase() : ch);
  }
  return out;
}

const sqlString = (v: string) => v.replace(/'/g, "''");

/** The SQL function of migration 0012 (kept here so a test checks both agree). */
export const FOLD_SQL = `create or replace function folders_fold(t text) returns text
  language sql immutable parallel safe strict
  as $$ select translate(lower(t), '${sqlString(FOLD_FROM)}', '${sqlString(FOLD_TO)}') $$;`;
