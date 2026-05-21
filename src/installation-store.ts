import type {
  InstallationStore,
  Installation,
  InstallationQuery,
} from "@slack/oauth";
import { prisma } from "./db.js";

export const prismaInstallationStore: InstallationStore = {
  storeInstallation: async (installation: Installation) => {
    const teamId = installation.team?.id;
    if (!teamId) throw new Error("No team ID in installation");

    const existing = await prisma.installation.findUnique({
      where: { teamId },
    });

    await prisma.installation.upsert({
      where: { teamId },
      update: {
        botToken: installation.bot?.token ?? "",
        botUserId: installation.bot?.userId,
        botId: installation.bot?.id,
        appId: installation.appId,
        teamName: installation.team?.name,
        installedByUserId: installation.user?.id,
        isActive: true,
      },
      create: {
        teamId,
        teamName: installation.team?.name,
        botToken: installation.bot?.token ?? "",
        botUserId: installation.bot?.userId,
        botId: installation.bot?.id,
        appId: installation.appId,
        installedByUserId: installation.user?.id,
      },
    });

    // Send welcome DM only on brand new installations, not reinstalls
    if (!existing && installation.user?.id && installation.bot?.token) {
      const { sendWelcomeDM } = await import("./welcome.js");
      sendWelcomeDM(installation.bot.token, installation.user.id).catch(
        console.error
      );
    }
  },

  fetchInstallation: async (query: InstallationQuery<boolean>) => {
    const teamId = query.teamId;
    if (!teamId) throw new Error("No team ID in query");

    const record = await prisma.installation.findUnique({
      where: { teamId },
    });

    if (!record || !record.isActive) {
      throw new Error(`No active installation found for team ${teamId}`);
    }

    return {
      team: { id: record.teamId, name: record.teamName ?? undefined },
      enterprise: undefined,
      bot: {
        token: record.botToken,
        userId: record.botUserId ?? "",
        id: record.botId ?? undefined,
        scopes: [],
      },
      appId: record.appId ?? undefined,
      user: {
        id: record.installedByUserId ?? "",
        scopes: [],
        token: undefined,
      },
    } as unknown as Installation;
  },

  deleteInstallation: async (query: InstallationQuery<boolean>) => {
    const teamId = query.teamId;
    if (!teamId) return;
    await prisma.installation.updateMany({
      where: { teamId },
      data: { isActive: false },
    });
  },
};
