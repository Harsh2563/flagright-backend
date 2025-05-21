import { z } from 'zod';
import { PaymentMethodType } from '../types/enums/UserEnums';

const PaymentMethodSchema = z.object({
  id: z.string().uuid(),
  type: z.nativeEnum(PaymentMethodType)
});

const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional()
});

const GoogleProfileSchema = z.object({
  displayName: z.string().optional(),
  email: z.string().email().optional(),
  picture: z.string().url().optional()
});

export const AddUserSchema = z.object({
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  phone: z.string().optional(),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .optional(),
  emailVerified: z.boolean().default(false),
  googleId: z.string().optional(),
  googleProfile: GoogleProfileSchema.optional(),
  address: AddressSchema.optional(),
  paymentMethods: z.array(PaymentMethodSchema).optional()
});

