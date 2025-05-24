import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError, ZodSchema } from 'zod';

export const validateSearchQuery = (schema: ZodSchema<any>) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      const validatedQuery = await schema.parseAsync(req.query);
      // Store validated query in a custom property instead of overwriting req.query
      (req as any).validatedQuery = validatedQuery;
      next();
    } catch (error) {
      console.error('Validation error:', error);

      if (error instanceof ZodError) {
        const errorMessages = error.errors.map((err) => ({
          field: err.path.join('.'),
          message: err.message,
        }));

        res.status(400).json({
          status: 'error',
          message: 'Invalid search query parameters',
          errors: errorMessages,
        });
        return;
      }

      res.status(500).json({
        status: 'error',
        message:
          error instanceof Error
            ? error.message
            : 'Internal server error during query validation',
      });
    }
  };
};
