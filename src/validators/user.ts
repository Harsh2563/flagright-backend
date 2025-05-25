import { z } from 'zod';
import { PaymentMethodType } from '../types/enums/UserEnums';

const PaymentMethodSchema = z.object({
  id: z.string().uuid(),
  type: z.nativeEnum(PaymentMethodType),
});

const AddressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

export const UserSchema = z.object({
  id: z.string().uuid('Invalid user ID format').optional(),
  firstName: z.string().min(2, 'First name must be at least 2 characters'),
  lastName: z.string().min(2, 'Last name must be at least 2 characters'),
  email: z.string().email('Invalid email format'),
  phone: z.string().optional(),
  address: AddressSchema.optional(),
  paymentMethods: z.array(PaymentMethodSchema).optional(),
});

export const ShortestPath = z.object({
  startUserId: z.string().uuid('Invalid user ID format'),  
  targetUserId: z.string().uuid('Invalid user ID format'),
})