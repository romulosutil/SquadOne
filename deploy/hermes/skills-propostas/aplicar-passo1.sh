#!/bin/bash
set -e
cd ~/.hermes/skills/productivity
Q=~/.hermes/skills-quarentena-20261009
mkdir -p personal-workspace-integration/references "$Q"
cp -n personal-workspace-integrations/references/* personal-workspace-integration/references/
cp -n oauth-first-integrations/references/* personal-workspace-integration/references/
cp /tmp/pwi.SKILL.md personal-workspace-integration/SKILL.md
mv personal-workspace-integrations "$Q"/
mv oauth-first-integrations "$Q"/
ls -R personal-workspace-integration
echo "--- restantes:"; ls | grep -i -E "integr|oauth"
echo "--- quarentena:"; ls "$Q"
