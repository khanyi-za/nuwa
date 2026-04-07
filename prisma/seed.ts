import 'dotenv/config';
import { PrismaClient, AccountStatus, UserRole } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface AdminSeed {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

/**
 * Reads admin credentials from environment variables.
 * Expected pattern: ADMIN_1_EMAIL, ADMIN_1_PASSWORD, ADMIN_1_FIRST_NAME, ADMIN_1_LAST_NAME
 *                   ADMIN_2_EMAIL, ADMIN_2_PASSWORD, ... etc.
 */
function readAdminsFromEnv(): AdminSeed[] {
  const admins: AdminSeed[] = [];
  let i = 1;

  while (process.env[`ADMIN_${i}_EMAIL`]) {
    const email = process.env[`ADMIN_${i}_EMAIL`]!.toLowerCase().trim();
    const password = process.env[`ADMIN_${i}_PASSWORD`];
    const firstName = process.env[`ADMIN_${i}_FIRST_NAME`];
    const lastName = process.env[`ADMIN_${i}_LAST_NAME`];

    if (!password || !firstName || !lastName) {
      throw new Error(
        `ADMIN_${i}_EMAIL is set but ADMIN_${i}_PASSWORD, ADMIN_${i}_FIRST_NAME, ` +
        `or ADMIN_${i}_LAST_NAME is missing. All four fields are required.`,
      );
    }

    admins.push({ email, password, firstName, lastName });
    i++;
  }

  return admins;
}

async function main() {
  const admins = readAdminsFromEnv();

  if (admins.length === 0) {
    console.log(
      'No admin env vars found. Set ADMIN_1_EMAIL, ADMIN_1_PASSWORD, ' +
      'ADMIN_1_FIRST_NAME, ADMIN_1_LAST_NAME in your .env to seed admins.',
    );
    return;
  }

  console.log(`Seeding ${admins.length} admin account(s)...`);

  for (const admin of admins) {
    const passwordHash = await bcrypt.hash(admin.password, 12);

    const existing = await prisma.user.findUnique({
      where: { email: admin.email },
      select: { id: true, role: true },
    });

    if (existing) {
      // Account already exists — upgrade role and status, but do NOT overwrite the password.
      // If the admin has already reset their password, we must not clobber it.
      await prisma.user.update({
        where: { email: admin.email },
        data: {
          role: UserRole.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          emailVerified: true,
          firstName: admin.firstName,
          lastName: admin.lastName,
        },
      });
      console.log(`  updated: ${admin.email} (was ${existing.role}, now ADMIN)`);
    } else {
      // New account — create with hashed password and ADMIN role.
      const created = await prisma.user.create({
        data: {
          email: admin.email,
          passwordHash,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: UserRole.ADMIN,
          accountStatus: AccountStatus.ACTIVE,
          emailVerified: true,
        },
        select: { id: true },
      });
      console.log(`  created: ${admin.email} (${created.id})`);
    }
  }

  console.log('Done. Remember to rotate admin passwords via /auth/forgot-password after first login.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err.message ?? err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
