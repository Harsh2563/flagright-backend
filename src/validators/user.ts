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
});

export const UserSearchSchema = z
  .object({
    searchText: z.string().optional(),

    // Pagination
    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),

    // Sorting
    sortBy: z
      .enum(['firstName', 'lastName', 'email', 'createdAt', 'updatedAt'])
      .optional()
      .default('createdAt'),
    sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),

    // Filter options based on user attributes - making it completely optional
    'filters.firstName': z.string().optional(),
    'filters.lastName': z.string().optional(),
    'filters.email': z.string().optional(),
    'filters.phone': z.string().optional(),

    // Address filters
    'filters.city': z.string().optional(),
    'filters.state': z.string().optional(),
    'filters.country': z.string().optional(),
    'filters.postalCode': z.string().optional(),

    // Date range filters
    'filters.createdAfter': z.string().datetime().optional(),
    'filters.createdBefore': z.string().datetime().optional(),
    'filters.updatedAfter': z.string().datetime().optional(),
    'filters.updatedBefore': z.string().datetime().optional(),
  })
  .transform((data) => {
    const {
      'filters.firstName': firstName,
      'filters.lastName': lastName,
      'filters.email': email,
      'filters.phone': phone,
      'filters.city': city,
      'filters.state': state,
      'filters.country': country,
      'filters.postalCode': postalCode,
      'filters.createdAfter': createdAfter,
      'filters.createdBefore': createdBefore,
      'filters.updatedAfter': updatedAfter,
      'filters.updatedBefore': updatedBefore,
      ...rest
    } = data;

    return {
      ...rest,
      filters: {
        firstName,
        lastName,
        email,
        phone,
        city,
        state,
        country,
        postalCode,
        createdAfter,
        createdBefore,
        updatedAfter,
        updatedBefore,
      },
    };
  });
