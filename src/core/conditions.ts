// Completion conditions — port of Go pkg/watcher/condition.go, the `--until`
// specs a goal-driven watch checks each cycle. Two kinds are portable to a
// browser/Node library:
//
//   http-200: <url>                          done when a GET returns 2xx
//   s3-empty: <wanted> minus <done>          done when every wanted key is done
//
// The Go `shell:` kind is deliberately NOT ported — it runs an arbitrary command
// and is CLI-daemon-only there (the hosted poller refuses it); it has no place in
// a library. s3-empty takes an injected lister seam so core never imports an AWS
// SDK.

/** A completion check evaluated each poll; Done true retires the watch. */
export interface Condition {
  done(signal?: AbortSignal): Promise<boolean>;
  /** The original spec, for display/logging. */
  readonly spec: string;
}

/** The slice of S3 the s3-empty condition needs; inject a real client or a fake. */
export interface S3Lister {
  /** Count objects under bucket/prefix (paginating internally if needed). */
  countObjects(bucket: string, prefix: string, signal?: AbortSignal): Promise<number>;
}

/**
 * Parse a `--until` spec into a Condition. Supported forms:
 *
 *   http-200: https://host/path
 *   s3-empty: s3://bucket/wanted minus s3://bucket/done/
 *
 * `s3Lister` is required to evaluate an s3-empty spec (throws without it), and
 * unused for http-200. Throws on a malformed/unknown spec, mirroring the Go
 * ParseCondition error shapes.
 */
export function parseCondition(spec: string, s3Lister?: S3Lister): Condition {
  const idx = spec.indexOf(":");
  if (idx < 0) {
    throw new Error(`invalid --until ${JSON.stringify(spec)}: want '<kind>: <arg>' (http-200 or s3-empty)`);
  }
  const kind = spec.slice(0, idx).trim().toLowerCase();
  const arg = spec.slice(idx + 1).trim();
  if (arg === "") {
    throw new Error(`invalid --until ${JSON.stringify(spec)}: missing argument after ${JSON.stringify(kind)}`);
  }

  switch (kind) {
    case "http-200":
      return new HttpCondition(spec, arg);
    case "s3-empty":
      return parseS3Empty(spec, arg, s3Lister);
    default:
      throw new Error(`invalid --until ${JSON.stringify(spec)}: unknown kind ${JSON.stringify(kind)} (want http-200 or s3-empty)`);
  }
}

/** Done when a GET to the URL returns a 2xx status. */
export class HttpCondition implements Condition {
  constructor(
    readonly spec: string,
    private readonly url: string,
  ) {}

  async done(signal?: AbortSignal): Promise<boolean> {
    const resp = await fetch(this.url, { method: "GET", signal });
    return resp.status >= 200 && resp.status < 300;
  }
}

/**
 * Done when (objects under the wanted prefix) minus (objects under the done
 * prefix) is empty — i.e. every wanted item has a corresponding done item. Both
 * sides are counted by key prefix, matching the pull-model completion state.
 */
export class S3EmptyCondition implements Condition {
  constructor(
    readonly spec: string,
    private readonly lister: S3Lister,
    private readonly wantBucket: string,
    private readonly wantPrefix: string,
    private readonly doneBucket: string,
    private readonly donePrefix: string,
  ) {}

  async done(signal?: AbortSignal): Promise<boolean> {
    const want = await this.lister.countObjects(this.wantBucket, this.wantPrefix, signal);
    const done = await this.lister.countObjects(this.doneBucket, this.donePrefix, signal);
    // Done when nothing remains: every wanted key has a corresponding done key.
    return done >= want;
  }
}

function parseS3Empty(spec: string, arg: string, s3Lister?: S3Lister): Condition {
  const sep = " minus ";
  const at = arg.indexOf(sep);
  if (at < 0) {
    throw new Error(`invalid s3-empty spec ${JSON.stringify(spec)}: want 's3://…/wanted minus s3://…/done'`);
  }
  const [wb, wp] = parseS3Uri(arg.slice(0, at).trim(), "s3-empty wanted");
  const [db, dp] = parseS3Uri(arg.slice(at + sep.length).trim(), "s3-empty done");
  if (!s3Lister) {
    throw new Error("s3-empty condition needs an S3 lister");
  }
  return new S3EmptyCondition(spec, s3Lister, wb, wp, db, dp);
}

/** Split "s3://bucket/key-or-prefix" into [bucket, key]. Missing key allowed. */
export function parseS3Uri(uri: string, ctx: string): [string, string] {
  if (!uri.startsWith("s3://")) {
    throw new Error(`${ctx}: invalid S3 URI ${JSON.stringify(uri)}: want s3://bucket/key`);
  }
  const rest = uri.slice("s3://".length);
  const slash = rest.indexOf("/");
  const bucket = slash < 0 ? rest : rest.slice(0, slash);
  const key = slash < 0 ? "" : rest.slice(slash + 1);
  if (bucket === "") {
    throw new Error(`${ctx}: invalid S3 URI ${JSON.stringify(uri)}: missing bucket`);
  }
  return [bucket, key];
}
