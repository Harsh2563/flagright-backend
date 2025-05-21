import { RequestHandler, Router } from 'express';
import { validateRequest } from '../middleware/validateRequest';
import { AddUserSchema } from '../validators/user';
import UserController from '../controllers/user';

const router = Router();

router.post('/', validateRequest(AddUserSchema), UserController.createUser as RequestHandler);

export default router;
