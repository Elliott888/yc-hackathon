import { classifyRepos } from "./categorize.js";
import { embedProfiles } from "./embedding.js";
import { pathsFor, readRawTrackBData, writeJsonl } from "./io.js";
import { buildContributionTopics, buildEngineerProfiles } from "./profile.js";
import { readRecipe } from "./recipe.js";
import { rankProfiles } from "./scoring.js";
import type { BuildIntelligenceOptions, BuildIntelligenceResult } from "./types.js";

export async function buildIntelligence(
  options: BuildIntelligenceOptions = {}
): Promise<BuildIntelligenceResult> {
  const rootDir = options.rootDir;
  const now = options.now ?? new Date();
  const paths = pathsFor(rootDir);
  const recipe = await readRecipe(rootDir);
  const raw = await readRawTrackBData(rootDir);

  const repoCategories = classifyRepos(raw.repos, recipe);
  const profiles = buildEngineerProfiles({ raw, recipe, repoCategories, now });
  const contributionTopics = buildContributionTopics(profiles);
  const embeddings = embedProfiles(profiles, recipe);
  const rankedLeads = rankProfiles({ profiles, recipe, now });

  await writeJsonl(paths.processed.repoCategories, repoCategories);
  await writeJsonl(paths.processed.contributionTopics, contributionTopics);
  await writeJsonl(paths.processed.engineerProfiles, profiles);
  await writeJsonl(paths.processed.engineerEmbeddings, embeddings);
  await writeJsonl(paths.processed.rankedLeads, rankedLeads);

  return {
    leadCount: rankedLeads.length,
    profileCount: profiles.length,
    repoCategoryCount: repoCategories.length,
    topLead: rankedLeads[0] ?? null
  };
}
