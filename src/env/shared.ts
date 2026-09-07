import { z } from "zod"

export const PRODUCTION_EXTENSION_ENV_DEFAULTS = {
  WXT_WEBSITE_URL: "https://www.readfrog.app",
  WXT_OFFICIAL_SITE_ORIGINS: "https://readfrog.app,https://www.readfrog.app",
} as const

export const LOCAL_EXTENSION_ENV_DEFAULTS = {
  WXT_WEBSITE_URL: "https://localhost:8877",
  WXT_OFFICIAL_SITE_ORIGINS: "http://localhost:8888,https://localhost:8877",
} as const

type RawEnvValue = string | boolean | undefined
export type RawExtensionEnv = Record<string, RawEnvValue>

const rawBooleanSchema = z
  .union([z.stringbool({ truthy: ["true"], falsy: ["false"] }), z.boolean()])
  .optional()

const strictStringSchema = z.string().refine((value) => value === value.trim(), {
  message: "must not include leading or trailing whitespace",
})

const strictUrlSchema = strictStringSchema.pipe(z.url()).refine((value) => !value.endsWith("/"), {
  message: "must not end with a trailing slash",
})

const strictOriginSchema = strictStringSchema
  .pipe(z.url())
  .refine((value) => new URL(value).origin === value, {
    message: "must be an origin without a trailing slash or path",
  })

const optionalNonEmptyStringSchema = z.string().min(1).optional()

function parseCommaSeparatedEntries(
  value: string,
  ctx: z.RefinementCtx,
  entrySchema: z.ZodTypeAny,
) {
  const parsedEntries: string[] = []

  for (const [index, entry] of value.split(",").entries()) {
    const result = entrySchema.safeParse(entry)

    if (!result.success) {
      for (const issue of result.error.issues) {
        ctx.addIssue({
          ...issue,
          path: [index, ...issue.path],
        })
      }

      return z.NEVER
    }

    parsedEntries.push(result.data as string)
  }

  return parsedEntries
}

export function isLocalPackagesEnabled(rawEnv: RawExtensionEnv) {
  return rawBooleanSchema.parse(rawEnv.WXT_USE_LOCAL_PACKAGES) ?? false
}

export function resolveExtensionEnv(rawEnv: RawExtensionEnv) {
  const defaults = isLocalPackagesEnabled(rawEnv)
    ? LOCAL_EXTENSION_ENV_DEFAULTS
    : PRODUCTION_EXTENSION_ENV_DEFAULTS

  return {
    ...rawEnv,
    WXT_WEBSITE_URL: rawEnv.WXT_WEBSITE_URL ?? defaults.WXT_WEBSITE_URL,
    WXT_OFFICIAL_SITE_ORIGINS:
      rawEnv.WXT_OFFICIAL_SITE_ORIGINS ?? defaults.WXT_OFFICIAL_SITE_ORIGINS,
  }
}

export function createExtensionClientEnvSchema(isProd: boolean, skipRequiredProductionEnv = false) {
  const requiresProductionEnv = isProd && !skipRequiredProductionEnv

  return {
    WXT_WEBSITE_URL: strictUrlSchema,
    WXT_OFFICIAL_SITE_ORIGINS: z
      .string()
      .transform((value, ctx) => parseCommaSeparatedEntries(value, ctx, strictOriginSchema)),
    WXT_GOOGLE_CLIENT_ID: requiresProductionEnv ? z.string().min(1) : optionalNonEmptyStringSchema,
  } satisfies Record<string, z.ZodType>
}
