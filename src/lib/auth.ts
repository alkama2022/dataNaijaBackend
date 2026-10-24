import { SignJWT, jwtVerify, type JWTPayload } from 'jose'

// JWT secret must be set via environment variable in production.
// A fallback is provided only so development can run without configuration.
if (!process.env.JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('JWT_SECRET must be set in production')
}
const secret = new TextEncoder().encode(
  process.env.JWT_SECRET || 'dev-secret-change-me-in-production'
)

/**
 * Sign a JWT payload with HS256.
 * Returns a token string that the Flutter app sends back in the
 * `Authorization: Bearer <token>` header on every authenticated request.
 */
export async function signToken(payload: JWTPayload): Promise<string> {
  return await new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret)
}

/**
 * Verify a JWT and return its payload.
 * Throws if the token is invalid or expired.
 */
export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secret)
  return payload
}
