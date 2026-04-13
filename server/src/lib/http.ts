import { Response } from "express"

type Payload = Record<string, unknown>

export function ok(
  res: Response,
  payload: Payload = {},
  status = 200
) {
  return res.status(status).json({
    success: true,
    ...payload,
  })
}

export function fail(
  res: Response,
  status: number,
  message: string,
  payload: Payload = {}
) {
  return res.status(status).json({
    success: false,
    message,
    ...payload,
  })
}
