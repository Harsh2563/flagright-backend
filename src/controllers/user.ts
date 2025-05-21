import { NextFunction, Request, Response } from 'express';
import UserModel from '../models/User';
import { AppError } from '../utils/appError';

export default class UserController {
  public static async createUser(
    req: Request,
    res: Response,
    next: NextFunction
  ) {
    try {
      const userData = req.body;
      const user = await UserModel.create(userData);

      return res.status(201).json({
        status: 'success',
        data: { user },
      });
    } catch (error) {
      if (error instanceof AppError) {
        return res.status(error.statusCode).json({
          status: 'error',
          message: error.message,
        });
      }
      next(error);
    }
  }
}
