import jwt from "jsonwebtoken"

export function getJwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim()
  if (!s) throw new Error("Missing JWT_SECRET")
  return s
}

export function signSessionJwt(user: {
  id: string
  role: string
  tokenVersion: number
}) {
  return jwt.sign(
    {
      sub: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    },
    getJwtSecret(),
    {
      expiresIn: "7d",
      algorithm: "HS256",
    }
  )
}

export function signImpersonationJwt(input: {
  userId: string
  role: string
  tokenVersion: number
  impersonatorId: string
}) {
  return jwt.sign(
    {
      sub: input.userId,
      role: input.role,
      tokenVersion: input.tokenVersion,
      imp: input.impersonatorId,
    },
    getJwtSecret(),
    {
      expiresIn: "4h",
      algorithm: "HS256",
    }
  )
}
