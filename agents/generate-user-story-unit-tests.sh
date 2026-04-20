#!/bin/bash

# Agent 3: Unit Test Generator
# This agent generates unit tests for implemented user stories
# It assumes the story implementation is already complete on the specified branch
# It only generates unit tests if applicable based on existing test patterns
# Supports interactive (-i) and non-interactive modes

set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source environment variables
if [ -f "$SCRIPT_DIR/.env" ]; then
	source "$SCRIPT_DIR/.env"
fi

# Source JIRA utilities
source "$SCRIPT_DIR/jira-utils.sh"

# Function to extract JIRA key from URL or return as-is if already a key
extract_jira_key() {
	local input="$1"
	# If input contains /browse/, extract the key after it
	if [[ "$input" =~ /browse/([A-Z]+-[0-9]+) ]]; then
		echo "${BASH_REMATCH[1]}"
	else
		# Return as-is (assume it's already a key)
		echo "$input"
	fi
}

# Default values from environment or hardcoded
WORKSPACE_ROOT="${DEMO_WORKSPACE_ROOT:-}"
JIRA_TICKET_ID=""
EPIC_ID=""
STORY_BRANCH=""
EXISTING_APP_BRD="${DEMO_EXISTING_APP_BRD:-}"
EXISTING_APP_ARCH="${DEMO_EXISTING_APP_ARCH:-}"
GIT_REPO="${DEMO_GIT_REPO:-}"
CONTEXT_DIRS=""
INTERACTIVE_MODE=false
POLICY_FILE="$SCRIPT_DIR/policies/unit-tests.policy.md"

# Parse arguments
while [[ $# -gt 0 ]]; do
	case $1 in
	-i | --interactive)
		INTERACTIVE_MODE=true
		shift
		;;
	--workspace-root)
		WORKSPACE_ROOT="$2"
		shift 2
		;;
	--jira-ticket-id)
		JIRA_TICKET_ID=$(extract_jira_key "$2")
		shift 2
		;;
	--epic-id)
		EPIC_ID=$(extract_jira_key "$2")
		shift 2
		;;
	--story-branch)
		STORY_BRANCH="$2"
		shift 2
		;;
	--existing-app-brd)
		EXISTING_APP_BRD="$2"
		shift 2
		;;
	--existing-app-arch)
		EXISTING_APP_ARCH="$2"
		shift 2
		;;
	--git-repo)
		GIT_REPO="$2"
		shift 2
		;;
	--context-dirs)
		CONTEXT_DIRS="$2"
		shift 2
		;;
	--policy-file)
		POLICY_FILE="$2"
		shift 2
		;;
	*)
		echo "Unknown option: $1"
		echo "Usage: $0 [-i|--interactive] [--workspace-root PATH] [--jira-ticket-id ID] [--epic-id ID] [--story-branch BRANCH] [--existing-app-brd PATH] [--existing-app-arch PATH] [--git-repo URL] [--context-dirs DIRS] [--policy-file FILE]"
		exit 1
		;;
	esac
done

# Interactive mode: prompt for inputs
if [ "$INTERACTIVE_MODE" = true ]; then
	echo "=========================================="
	echo "Interactive Mode: Unit Test Generator"
	echo "=========================================="
	echo ""

	# Prompt for Git repository
	if [ -n "$GIT_REPO" ]; then
		read -p "Enter Git repository URL [default: $GIT_REPO]: " input
		GIT_REPO="${input:-$GIT_REPO}"
	else
		read -p "Enter Git repository URL (optional, press Enter to skip): " GIT_REPO
	fi

	# Prompt for workspace root
	if [ -n "$WORKSPACE_ROOT" ]; then
		read -p "Enter workspace root directory [default: $WORKSPACE_ROOT]: " input
		WORKSPACE_ROOT="${input:-$WORKSPACE_ROOT}"
	else
		read -p "Enter workspace root directory [default: .]: " input
		WORKSPACE_ROOT="${input:-.}"
	fi

	# Prompt for JIRA ticket ID
	if [ -z "$JIRA_TICKET_ID" ]; then
		read -p "Enter JIRA ticket ID or URL (Story): " JIRA_TICKET_ID
		JIRA_TICKET_ID=$(extract_jira_key "$JIRA_TICKET_ID")
	fi

	# Prompt for Epic ID
	if [ -z "$EPIC_ID" ]; then
		read -p "Enter Epic ID or URL: " EPIC_ID
		EPIC_ID=$(extract_jira_key "$EPIC_ID")
	fi

	# Prompt for story branch
	if [ -z "$STORY_BRANCH" ]; then
		# Suggest default branch name based on JIRA ticket ID
		if [ -n "$JIRA_TICKET_ID" ]; then
			DEFAULT_BRANCH="story/$JIRA_TICKET_ID"
			read -p "Enter story branch name [default: $DEFAULT_BRANCH]: " input
			STORY_BRANCH="${input:-$DEFAULT_BRANCH}"
		else
			read -p "Enter story branch name (with implementation): " STORY_BRANCH
		fi
	fi

	# Prompt for existing application BRD
	if [ -n "$EXISTING_APP_BRD" ]; then
		read -p "Enter existing application BRD document path [default: $EXISTING_APP_BRD]: " input
		EXISTING_APP_BRD="${input:-$EXISTING_APP_BRD}"
	else
		read -p "Enter existing application BRD document path: " EXISTING_APP_BRD
	fi

	# Prompt for existing application architecture
	if [ -n "$EXISTING_APP_ARCH" ]; then
		read -p "Enter existing application architecture documentation path [default: $EXISTING_APP_ARCH]: " input
		EXISTING_APP_ARCH="${input:-$EXISTING_APP_ARCH}"
	else
		read -p "Enter existing application architecture documentation path: " EXISTING_APP_ARCH
	fi

	# Prompt for context directories
	read -p "Enter context directories (comma-separated) [default: src,docs]: " input
	CONTEXT_DIRS="${input:-src,docs}"

	# Prompt for policy file
	read -p "Enter policy file path [default: $POLICY_FILE]: " input
	POLICY_FILE="${input:-$POLICY_FILE}"

	echo ""
fi

# Non-interactive mode: use environment variables if parameters not provided
if [ "$INTERACTIVE_MODE" = false ]; then
	WORKSPACE_ROOT="${WORKSPACE_ROOT:-${ENV_WORKSPACE_ROOT:-.}}"
	JIRA_TICKET_ID=$(extract_jira_key "${JIRA_TICKET_ID:-${ENV_JIRA_TICKET_ID}}")
	EPIC_ID=$(extract_jira_key "${EPIC_ID:-${ENV_EPIC_ID}}")
	STORY_BRANCH="${STORY_BRANCH:-${ENV_STORY_BRANCH}}"
	EXISTING_APP_BRD="${EXISTING_APP_BRD:-${ENV_EXISTING_APP_BRD}}"
	EXISTING_APP_ARCH="${EXISTING_APP_ARCH:-${ENV_EXISTING_APP_ARCH}}"
	GIT_REPO="${GIT_REPO:-${ENV_GIT_REPO}}"
	CONTEXT_DIRS="${CONTEXT_DIRS:-${ENV_CONTEXT_DIRS:-src,docs}}"
	POLICY_FILE="${POLICY_FILE:-${ENV_POLICY_FILE:-$SCRIPT_DIR/policies/unit-tests.policy.md}}"
fi

# Auto-generate story branch name if not provided
if [ -z "$STORY_BRANCH" ] && [ -n "$JIRA_TICKET_ID" ]; then
	STORY_BRANCH="story/$JIRA_TICKET_ID"
	echo "Auto-generated story branch name: $STORY_BRANCH"
	echo ""
fi

# Validate required parameters
if [ -z "$WORKSPACE_ROOT" ]; then
	echo "Error: Workspace root is required"
	echo "Provide via --workspace-root argument, interactive mode (-i), or ENV_WORKSPACE_ROOT environment variable"
	exit 1
fi

if [ -z "$JIRA_TICKET_ID" ]; then
	echo "Error: JIRA ticket ID is required"
	echo "Provide via --jira-ticket-id argument, interactive mode (-i), or ENV_JIRA_TICKET_ID environment variable"
	exit 1
fi

if [ -z "$EPIC_ID" ]; then
	echo "Error: Epic ID is required"
	echo "Provide via --epic-id argument, interactive mode (-i), or ENV_EPIC_ID environment variable"
	exit 1
fi

if [ -z "$STORY_BRANCH" ]; then
	echo "Error: Story branch is required"
	echo "Provide via --story-branch argument, interactive mode (-i), or ENV_STORY_BRANCH environment variable"
	exit 1
fi

if [ -z "$EXISTING_APP_BRD" ]; then
	echo "Error: Existing application BRD is required"
	echo "Provide via --existing-app-brd argument, interactive mode (-i), or ENV_EXISTING_APP_BRD environment variable"
	exit 1
fi

if [ -z "$EXISTING_APP_ARCH" ]; then
	echo "Error: Existing application architecture is required"
	echo "Provide via --existing-app-arch argument, interactive mode (-i), or ENV_EXISTING_APP_ARCH environment variable"
	exit 1
fi

# Validate files exist
if [ ! -f "$EXISTING_APP_BRD" ]; then
	echo "Error: Existing application BRD file not found: $EXISTING_APP_BRD"
	exit 1
fi

if [ ! -f "$EXISTING_APP_ARCH" ]; then
	echo "Error: Existing application architecture file not found: $EXISTING_APP_ARCH"
	exit 1
fi

# Display configuration
echo "=========================================="
echo "Agent 3: Unit Test Generator"
echo "=========================================="
echo "JIRA Ticket ID: $JIRA_TICKET_ID"
echo "Epic ID: $EPIC_ID"
echo "Story Branch: $STORY_BRANCH"
echo "Git Repository: ${GIT_REPO:-Not provided}"
echo "Existing App BRD: $EXISTING_APP_BRD"
echo "Existing App Architecture: $EXISTING_APP_ARCH"
echo "Workspace Root: $WORKSPACE_ROOT"
echo "Context Directories: $CONTEXT_DIRS"
echo "Policy File: $POLICY_FILE"
echo ""
echo "NOTE: This agent assumes story implementation"
echo "      is already complete on branch: $STORY_BRANCH"
echo "=========================================="
echo ""

# Clone Git repository if provided (to get latest code with implementation)
if [ -n "$GIT_REPO" ]; then
	# Extract repo name from URL (last part without .git)
	REPO_NAME=$(basename "$GIT_REPO" .git)
	REPO_DIR="$WORKSPACE_ROOT/$REPO_NAME"

	# Delete existing repo directory if it exists
	if [ -d "$REPO_DIR" ]; then
		echo "Deleting existing repository directory: $REPO_DIR"
		rm -rf "$REPO_DIR"
	fi

	# Clone fresh copy
	echo "Cloning repository from $GIT_REPO to $REPO_DIR..."
	git clone "$GIT_REPO" "$REPO_DIR"
	echo "Repository cloned successfully."
	echo ""

	# Copy BRD files into cloned repository if they exist (for Auggie access)
	PARENT_DIR=$(dirname "$REPO_DIR")
	if [ -n "$EXISTING_APP_BRD" ] && [[ "$EXISTING_APP_BRD" != /* ]]; then
		# Relative path - copy from parent directory
		SRC_BRD="$PARENT_DIR/$EXISTING_APP_BRD"
		if [ -f "$SRC_BRD" ]; then
			echo "Copying BRD file to cloned repository..."
			cp "$SRC_BRD" "$REPO_DIR/"
		fi
	fi

	# Update workspace root to the cloned repository for git operations
	WORKSPACE_ROOT="$REPO_DIR"
fi

# Navigate to workspace
cd "$WORKSPACE_ROOT"

# Check if we're in a git repository
if [ ! -d ".git" ]; then
	echo "Error: Not a git repository at $WORKSPACE_ROOT"
	echo "Please provide a valid git repository via --git-repo or ensure workspace is a git repo"
	exit 1
fi

# Fetch latest changes from remote
echo "Fetching latest changes from remote..."
git fetch origin

# Checkout the story branch (assumes implementation is already done)
echo "Checking out story branch: $STORY_BRANCH"
if git show-ref --verify --quiet "refs/heads/$STORY_BRANCH"; then
	# Branch exists locally, just checkout
	git checkout "$STORY_BRANCH"
elif git show-ref --verify --quiet "refs/remotes/origin/$STORY_BRANCH"; then
	# Branch exists on remote, checkout and track
	echo "Branch found on remote, creating local tracking branch..."
	git checkout -b "$STORY_BRANCH" "origin/$STORY_BRANCH"
else
	echo "Error: Branch $STORY_BRANCH not found locally or on remote"
	echo "Please ensure the implementation agent has created and pushed the branch"
	echo ""
	echo "Available branches:"
	git branch -a | grep -E "(story/|main|develop)" || git branch -a
	exit 1
fi

# Pull latest changes
echo "Pulling latest changes from remote..."
git pull origin "$STORY_BRANCH" || echo "Warning: Could not pull from remote"

echo ""

# Create artifacts directory structure
ARTIFACTS_DIR="sdlc-artifacts"
UNIT_TESTS_ARTIFACTS_DIR="$ARTIFACTS_DIR/unit-tests"
mkdir -p "$UNIT_TESTS_ARTIFACTS_DIR"

echo "Artifacts will be saved to: $UNIT_TESTS_ARTIFACTS_DIR"
echo ""

# Fetch JIRA ticket details
echo "Fetching JIRA ticket details..."
STORY_JSON=$(get_jira_issue "$JIRA_TICKET_ID")

if [ -z "$STORY_JSON" ]; then
	echo "Error: Failed to fetch JIRA ticket: $JIRA_TICKET_ID"
	exit 1
fi

# Fetch Epic details
echo "Fetching Epic details..."
EPIC_JSON=$(get_jira_issue "$EPIC_ID")

if [ -z "$EPIC_JSON" ]; then
	echo "Error: Failed to fetch Epic: $EPIC_ID"
	exit 1
fi

# Extract Epic information
EPIC_TITLE=$(echo "$EPIC_JSON" | jq -r '.fields.summary // empty')
EPIC_DESCRIPTION_ADF=$(echo "$EPIC_JSON" | jq -c '.fields.description // {}')

echo "Epic: $EPIC_ID - $EPIC_TITLE"
echo ""

# Extract Story information
STORY_TITLE=$(echo "$STORY_JSON" | jq -r '.fields.summary // empty')
STORY_DESCRIPTION_ADF=$(echo "$STORY_JSON" | jq -c '.fields.description // {}')
STORY_PRIORITY=$(echo "$STORY_JSON" | jq -r '.fields.priority.name // "Medium"')

echo "Story: $JIRA_TICKET_ID - $STORY_TITLE"
echo "Priority: $STORY_PRIORITY"
echo ""

# Verify story is linked to the epic
STORY_EPIC_KEY=$(echo "$STORY_JSON" | jq -r '.fields.parent.key // empty')
if [ -n "$STORY_EPIC_KEY" ] && [ "$STORY_EPIC_KEY" != "$EPIC_ID" ]; then
	echo "Error: Story $JIRA_TICKET_ID is linked to Epic $STORY_EPIC_KEY, but you specified Epic $EPIC_ID"
	exit 1
fi

echo ""

# Load policy file
if [ ! -f "$POLICY_FILE" ]; then
	echo "Error: Policy file not found: $POLICY_FILE"
	exit 1
fi

POLICY_CONTENT=$(cat "$POLICY_FILE")

# Convert ADF to markdown for better readability in prompt
EPIC_DESCRIPTION_MD=$(echo "$EPIC_DESCRIPTION_ADF" | adf2md 2>/dev/null || echo "$EPIC_DESCRIPTION_ADF")
STORY_DESCRIPTION_MD=$(echo "$STORY_DESCRIPTION_ADF" | adf2md 2>/dev/null || echo "$STORY_DESCRIPTION_ADF")

# Build unit test plan generation instruction
UNIT_TEST_PLAN_INSTRUCTION="$POLICY_CONTENT

---

EXECUTION CONTEXT:

EPIC:
Epic ID: $EPIC_ID
Title: $EPIC_TITLE
Description:
$EPIC_DESCRIPTION_MD

USER STORY:
Story ID: $JIRA_TICKET_ID
Title: $STORY_TITLE
Priority: $STORY_PRIORITY
Description:
$STORY_DESCRIPTION_MD

IMPLEMENTATION:
- Story Branch: $STORY_BRANCH (contains completed implementation)
- Existing Application BRD: $EXISTING_APP_BRD
- Existing Application Architecture: $EXISTING_APP_ARCH
- Workspace Root: $WORKSPACE_ROOT
- Context Directories: $CONTEXT_DIRS
- Output Directory: $UNIT_TESTS_ARTIFACTS_DIR/

Create the following markdown files in $UNIT_TESTS_ARTIFACTS_DIR/:
unit-test-plan.md - A test plan which briefly describes the tests to be written i.e., cases we're going to cover:
  - Assessment of whether UTs are needed (and why/why not)
  - Test cases, scenarios, and expected outcomes (if applicable)
  - Existing test patterns to follow

Begin unit test plan generation now."

# Clean up existing artifacts to start with a clean slate
echo ""
echo "=========================================="
echo "Cleaning Up Existing Artifacts"
echo "=========================================="

if [ -d "$UNIT_TESTS_ARTIFACTS_DIR" ]; then
	echo "Found existing artifacts directory: $UNIT_TESTS_ARTIFACTS_DIR"
	echo "Removing old artifacts to start fresh..."

	# Show what will be deleted
	if [ "$(ls -A "$UNIT_TESTS_ARTIFACTS_DIR" 2>/dev/null)" ]; then
		echo ""
		echo "Files to be removed:"
		ls -la "$UNIT_TESTS_ARTIFACTS_DIR"
		echo ""
	fi

	# Remove the directory
	rm -rf "$UNIT_TESTS_ARTIFACTS_DIR"
	echo "✓ Old artifacts removed"
else
	echo "No existing artifacts found - starting fresh"
fi

# Create fresh artifacts directory
mkdir -p "$UNIT_TESTS_ARTIFACTS_DIR"
echo "✓ Created clean artifacts directory: $UNIT_TESTS_ARTIFACTS_DIR"
echo ""

# Run Auggie agent to generate test plans (PHASE 1)
echo "=========================================="
echo "PHASE 1: Generating Unit Test Plan"
echo "=========================================="
echo "Running Auggie agent to analyze implementation and create test plan..."
echo ""

auggie -p \
	--workspace-root "$WORKSPACE_ROOT" \
	"$UNIT_TEST_PLAN_INSTRUCTION"

# Check if test plans were generated
if [ ! -f "$UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md" ]; then
	echo "Error: unit-test-plan.md not found"
	echo "Expected location: $UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md"
	exit 1
fi

echo ""
echo "=========================================="
echo "Unit Test Plan Generated!"
echo "=========================================="
echo "Location: $UNIT_TESTS_ARTIFACTS_DIR/"
echo ""
echo "Generated files:"
ls -la "$UNIT_TESTS_ARTIFACTS_DIR/"
echo "=========================================="

# Display test plan
echo ""
echo "UNIT TEST PLAN:"
echo "=========================================="
cat "$UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md"
echo "=========================================="

# Pause for manual approval
echo ""
echo "=========================================="
echo "REVIEW REQUIRED - Unit Test Plan Generated"
echo "=========================================="
echo ""
echo "📄 Test Plan Location:"
echo "   $UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md"
echo ""
echo "Please review the test plan to verify:"
echo "  ✓ Applicability assessment is correct"
echo "  ✓ Test scenarios cover all requirements"
echo "  ✓ Mocking strategy is appropriate"
echo "  ✓ Test files and structure follow conventions"
echo ""
echo "You can:"
echo "  • Open the file in your editor to review"
echo "  • Modify the plan if needed"
echo "  • Approve to proceed with test code generation"
echo ""
read -p "Do you approve this test plan and want to proceed with Phase 2 (code generation)? (y/n): " APPROVAL

if [ "$APPROVAL" != "y" ] && [ "$APPROVAL" != "Y" ]; then
	echo ""
	echo "Unit test generation paused."
	echo "You can review and modify the test plan at:"
	echo "  $UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md"
	echo ""
	echo "To resume, re-run this script with the same parameters."
	exit 0
fi

# Generate actual test code (PHASE 2)
echo ""
echo "=========================================="
echo "PHASE 2: Generating Unit Test Code"
echo "=========================================="

TEST_CODE_INSTRUCTION="$POLICY_CONTENT

---

EXECUTION CONTEXT:

EPIC:
Epic ID: $EPIC_ID
Title: $EPIC_TITLE
Description:
$EPIC_DESCRIPTION_MD

USER STORY:
Story ID: $JIRA_TICKET_ID
Title: $STORY_TITLE
Priority: $STORY_PRIORITY
Description:
$STORY_DESCRIPTION_MD

IMPLEMENTATION:
- Story Branch: $STORY_BRANCH (contains completed implementation)
- Approved Unit Test Plan: $UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md
- Existing Application BRD: $EXISTING_APP_BRD
- Existing Application Architecture: $EXISTING_APP_ARCH
- Workspace Root: $WORKSPACE_ROOT
- Context Directories: $CONTEXT_DIRS

Generate actual unit test code files based on the approved test plan at $UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md.
Place test files in the appropriate test directories following codebase conventions.
Do not alter the approved test plan.
Begin unit test code generation now."

echo "Running Auggie agent to generate unit test code..."
echo ""

auggie -p \
	--workspace-root "$WORKSPACE_ROOT" \
	"$TEST_CODE_INSTRUCTION"

echo ""
echo "=========================================="
echo "Unit Test Code Generation Complete!"
echo "=========================================="

# Commit and push unit tests to the story branch
echo ""
echo "=========================================="
echo "Committing Unit Tests to Story Branch"
echo "=========================================="

# Navigate to workspace
cd "$WORKSPACE_ROOT"

# Verify we're on the story branch
CURRENT_BRANCH=$(git rev-parse --abbrev-ref HEAD)
if [ "$CURRENT_BRANCH" != "$STORY_BRANCH" ]; then
	echo "Warning: Current branch ($CURRENT_BRANCH) doesn't match story branch ($STORY_BRANCH)"
	echo "Checking out $STORY_BRANCH..."
	git checkout "$STORY_BRANCH"
fi

# Stage all changes (unit tests only)
echo "Staging unit test changes..."
git add .

# Check if there are changes to commit
if git diff --staged --quiet; then
	echo ""
	echo "=========================================="
	echo "No unit test changes to commit"
	echo "=========================================="
	echo "This may indicate that:"
	echo "  1. Unit tests were not applicable for this implementation"
	echo "  2. Unit tests already exist and no new tests were needed"
	echo "  3. The test plan indicated tests were not needed"
	exit 0
fi

# Commit changes with story title as commit message
echo "Committing unit tests..."
COMMIT_MESSAGE="test($JIRA_TICKET_ID): Add unit tests"

git commit -m "$COMMIT_MESSAGE" || {
	echo "Error: Failed to commit changes"
	exit 1
}

# Push to remote
echo "Pushing unit tests to remote branch: $STORY_BRANCH"
git push origin "$STORY_BRANCH" || {
	echo "Error: Failed to push to remote"
	echo "You may need to push manually: git push origin $STORY_BRANCH"
	exit 1
}

echo ""
echo "=========================================="
echo "Unit Tests Committed Successfully!"
echo "=========================================="
echo "Story: $JIRA_TICKET_ID - $STORY_TITLE"
echo "Branch: $STORY_BRANCH"
echo "Unit tests have been added to the story implementation branch"
echo ""
echo "Next Steps:"
echo "  1. Run the unit tests to verify they pass"
echo "  2. Review test coverage"
echo "  3. The unit tests will be included in the story's PR"
echo ""
echo "Artifacts:"
echo "  - Test Plan: $UNIT_TESTS_ARTIFACTS_DIR/unit-test-plan.md"
echo "=========================================="

exit 0
