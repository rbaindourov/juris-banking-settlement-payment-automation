import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema, ZodError } from 'zod';

export const boundedString = (min = 1, max = 100, fieldName = 'Field') =>
  z.string()
    .min(min, `${fieldName} must be at least ${min} characters long`)
    .max(max, `${fieldName} must not exceed ${max} characters`);

export const emailSchema = z.string()
  .email('Valid email address required')
  .max(255, 'Email must not exceed 255 characters');

export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters long')
  .max(128, 'Password must not exceed 128 characters');

export const loginPasswordSchema = z.string()
  .min(1, 'Password is required')
  .max(128, 'Password must not exceed 128 characters');

export const fullNameSchema = z.string()
  .min(1, 'Full name must be at least 1 character long')
  .max(100, 'Full name must not exceed 100 characters');

interface ValidationSchema {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validateRequest(schemas: ValidationSchema) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (schemas.body) {
        req.body = await schemas.body.parseAsync(req.body);
      }
      if (schemas.query) {
        req.query = await schemas.query.parseAsync(req.query);
      }
      if (schemas.params) {
        req.params = await schemas.params.parseAsync(req.params);
      }
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          error: 'Validation failed',
          details: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        });
        return;
      }
      next(error);
    }
  };
}
