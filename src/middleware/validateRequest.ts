import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, z } from 'zod';

/**
 * Middleware factory to validate request body against a Zod schema
 * @param schema The Zod schema to validate against
 */

export const validateRequest = (schema: AnyZodObject) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: result.error.format(),
      });
      return;
    }
    req.body = result.data;
    next();
  };
};