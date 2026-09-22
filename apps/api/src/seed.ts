import "dotenv/config";
import { prisma } from "@ke/database";
import { hashPassword, pinCode } from "@ke/auth";

const demoEmail = process.env.DEMO_ADMIN_EMAIL ?? "admin@ke.local";
const demoPassword = process.env.DEMO_ADMIN_PASSWORD ?? "admin123";

async function main(): Promise<void> {
  const admin = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {},
    create: {
      email: demoEmail,
      name: "Super Admin",
      passwordHash: hashPassword(demoPassword),
      role: "SUPER_ADMIN",
    },
  });
  console.log(`Super admin ready: ${demoEmail} / ${demoPassword}`);

  const event = await prisma.event.upsert({
    where: { slug: "ke-startup-award-2026" },
    update: {
      status: "ACTIVE",
      description: "Demo event for the secure pitching & judging platform.",
    },
    create: {
      title: "KE Startup Award 2026",
      slug: "ke-startup-award-2026",
      description: "Demo event for the secure pitching & judging platform.",
      status: "ACTIVE",
      createdById: admin.id,
    },
  });

  await prisma.eventSecuritySettings.upsert({
    where: { eventId: event.id },
    update: {},
    create: {
      eventId: event.id,
      watermark: true,
      watermarkText: "CONFIDENTIAL",
      singleDevice: true,
      hideOnTabSwitch: true,
      requireFullscreen: false,
      allowJudgeNavigation: true,
      detectionAction: "LOG",
    },
  });

  const preliminary =
    (await prisma.pitchSection.findFirst({
      where: { eventId: event.id, name: "Preliminary Round" },
    })) ??
    (await prisma.pitchSection.create({
      data: { eventId: event.id, name: "Preliminary Round", type: "PRELIMINARY", order: 1 },
    }));

  const finalSection =
    (await prisma.pitchSection.findFirst({
      where: { eventId: event.id, name: "Final Round" },
    })) ??
    (await prisma.pitchSection.create({
      data: { eventId: event.id, name: "Final Round", type: "FINAL", order: 2 },
    }));

  const startups = [
    { name: "Demo Startup", description: "A sample startup for testing the viewer. Upload a deck to present." },
    { name: "Second Startup", description: "Another sample startup." },
  ];
  for (const s of startups) {
    const exists = await prisma.startup.findFirst({
      where: { eventId: event.id, name: s.name },
    });
    if (!exists) {
      await prisma.startup.create({
        data: { eventId: event.id, pitchSectionId: preliminary.id, ...s },
      });
    }
  }

  const judges = [
    { judgeCode: "J001", name: "Alice Judge", email: "alice@ke.local" },
    { judgeCode: "J002", name: "Bob Judge", email: "bob@ke.local" },
  ];
  const created = [];
  for (const j of judges) {
    const judge = await prisma.judge.upsert({
      where: { eventId_judgeCode: { eventId: event.id, judgeCode: j.judgeCode } },
      update: {},
      create: { eventId: event.id, ...j, pinHash: hashPassword(pinCode(4)) },
    });
    created.push(judge);
  }

  const j1 = created[0];
  const j2 = created[1];
  if (!j1 || !j2) throw new Error("Judge seeding failed");
  await prisma.judgeAssignment.upsert({
    where: { judgeId_pitchSectionId: { judgeId: j1.id, pitchSectionId: preliminary.id } },
    update: {},
    create: { judgeId: j1.id, pitchSectionId: preliminary.id },
  });
  await prisma.judgeAssignment.upsert({
    where: { judgeId_pitchSectionId: { judgeId: j1.id, pitchSectionId: finalSection.id } },
    update: {},
    create: { judgeId: j1.id, pitchSectionId: finalSection.id },
  });
  await prisma.judgeAssignment.upsert({
    where: { judgeId_pitchSectionId: { judgeId: j2.id, pitchSectionId: preliminary.id } },
    update: {},
    create: { judgeId: j2.id, pitchSectionId: preliminary.id },
  });
  await prisma.judgeAssignment.upsert({
    where: { judgeId_pitchSectionId: { judgeId: j2.id, pitchSectionId: finalSection.id } },
    update: {},
    create: { judgeId: j2.id, pitchSectionId: finalSection.id },
  });

  console.log("Seeded demo event:", event.slug);
  console.log("Judges: J001 (Alice), J002 (Bob)");
  console.log("TIP: upload a PPTX/PDF deck for a startup, then start a pitch session.");

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});