// Read-only production config & state inspector for lunaexpress.
// Lists Secret Manager secret names and enabled version counts (metadata only, never secret values),
// live Firestore ruleset release metadata + drift status against firestore.rules,
// and live Firestore composite indexes.
//
// From functions/:
//   npm run check:prod-config
const fs = require('node:fs');
const path = require('node:path');
const { accessToken, getJson, normalize, PROJECT_ID } = require('./check-firestore-rules-drift');

const RULES_PATH = path.resolve(__dirname, '../../firestore.rules');

async function main() {
  const token = await accessToken();

  // 1. Secret Manager metadata (names and enabled version numbers only)
  const secretsList = await getJson(
    `https://secretmanager.googleapis.com/v1/projects/${PROJECT_ID}/secrets`,
    token,
  );
  const secrets = [];
  for (const s of secretsList.secrets || []) {
    const shortName = s.name.split('/').pop();
    const vers = await getJson(
      `https://secretmanager.googleapis.com/v1/${s.name}/versions`,
      token,
    );
    const enabled = (vers.versions || [])
      .filter((v) => v.state === 'ENABLED')
      .map((v) => v.name.split('/').pop());
    secrets.push({ name: shortName, enabledVersions: enabled });
  }

  // 2. Live Firestore ruleset vs local firestore.rules
  const release = await getJson(
    `https://firebaserules.googleapis.com/v1/projects/${PROJECT_ID}/releases/cloud.firestore`,
    token,
  );
  const ruleset = await getJson(`https://firebaserules.googleapis.com/v1/${release.rulesetName}`, token);
  const liveFile =
    ruleset.source.files.find((f) => f.name === 'firestore.rules') || ruleset.source.files[0];
  const inSync = normalize(fs.readFileSync(RULES_PATH, 'utf8')) === normalize(liveFile.content);

  // 3. Live Firestore composite indexes
  const idxList = await getJson(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/collectionGroups/-/indexes`,
    token,
  );
  const compositeIndexes = (idxList.indexes || []).map((i) => ({
    collectionGroup: i.name.split('/collectionGroups/')[1]?.split('/')[0] || '',
    state: i.state,
    fields: (i.fields || []).map((f) => `${f.fieldPath}:${f.order || f.arrayConfig}`),
  }));

  console.log(
    JSON.stringify(
      {
        projectId: PROJECT_ID,
        checkedAt: new Date().toISOString(),
        secretManager: secrets,
        firestoreRules: {
          rulesetName: release.rulesetName,
          updateTime: release.updateTime,
          matchesRepoFirestoreRules: inSync,
        },
        compositeIndexes,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(`Could not inspect production config: ${err.message}`);
  process.exitCode = 1;
});
