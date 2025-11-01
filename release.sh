#!/bin/bash

# Lava Flow Release Script
# Automates the process of creating a new release

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Helper functions
print_header() {
    echo -e "\n${BLUE}===================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}===================================================${NC}\n"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Check if we're in a git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    print_error "Not in a git repository!"
    exit 1
fi

# Check if there are uncommitted changes
if [[ -n $(git status -s) ]]; then
    print_warning "You have uncommitted changes:"
    git status -s
    echo
    read -p "Do you want to continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_info "Aborted."
        exit 0
    fi
fi

# Get current version from package.json
CURRENT_VERSION=$(node -p "require('./package.json').version")
print_info "Current version: v${CURRENT_VERSION}"

# Ask for new version
echo
echo "Select version bump type:"
echo "  1) Patch (4.1.1 -> 4.1.2)"
echo "  2) Minor (4.1.1 -> 4.2.0)"
echo "  3) Major (4.1.1 -> 5.0.0)"
echo "  4) Custom version"
echo "  5) Use current version (${CURRENT_VERSION})"
echo
read -p "Enter choice (1-5): " -n 1 -r VERSION_CHOICE
echo

case $VERSION_CHOICE in
    1)
        # Patch bump
        NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{printf "%d.%d.%d", $1, $2, $3+1}')
        ;;
    2)
        # Minor bump
        NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{printf "%d.%d.0", $1, $2+1}')
        ;;
    3)
        # Major bump
        NEW_VERSION=$(echo $CURRENT_VERSION | awk -F. '{printf "%d.0.0", $1+1}')
        ;;
    4)
        # Custom version
        read -p "Enter new version (without 'v'): " NEW_VERSION
        ;;
    5)
        # Use current version
        NEW_VERSION=$CURRENT_VERSION
        ;;
    *)
        print_error "Invalid choice"
        exit 1
        ;;
esac

print_info "New version will be: v${NEW_VERSION}"

# Confirm
echo
read -p "Continue with release v${NEW_VERSION}? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_info "Aborted."
    exit 0
fi

print_header "Starting Release Process for v${NEW_VERSION}"

# Step 1: Update package.json version if changed
if [[ "$NEW_VERSION" != "$CURRENT_VERSION" ]]; then
    print_info "Updating package.json version..."

    # Use npm to update version (handles package.json and package-lock.json)
    npm version $NEW_VERSION --no-git-tag-version

    print_success "Version updated in package.json"
else
    print_info "Version unchanged, skipping package.json update"
fi

# Step 2: Build the project
print_header "Building Project"
print_info "Running: npm run build"
npm run build
print_success "Build completed"

# Step 3: Create release package
print_header "Creating Release Package"
print_info "Running: npm run release"
npm run release
print_success "Release package created"

# Verify bundle files exist
if [[ ! -f "bundle/lava-flow-jrayc.zip" ]]; then
    print_error "bundle/lava-flow-jrayc.zip not found!"
    exit 1
fi

if [[ ! -f "bundle/module.json" ]]; then
    print_error "bundle/module.json not found!"
    exit 1
fi

print_success "Release files verified"

# Step 4: Commit changes (if version changed)
if [[ "$NEW_VERSION" != "$CURRENT_VERSION" ]]; then
    print_header "Committing Changes"

    read -p "Enter commit message (or press Enter for default): " COMMIT_MSG

    if [[ -z "$COMMIT_MSG" ]]; then
        COMMIT_MSG="Release v${NEW_VERSION}"
    fi

    git add package.json package-lock.json
    git commit -m "$COMMIT_MSG"
    print_success "Changes committed"
else
    print_info "Skipping commit (no version change)"
fi

# Step 5: Create and push git tag
print_header "Creating Git Tag"

# Check if tag already exists
if git rev-parse "v${NEW_VERSION}" >/dev/null 2>&1; then
    print_warning "Tag v${NEW_VERSION} already exists"
    read -p "Delete and recreate tag? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        git tag -d "v${NEW_VERSION}"
        print_info "Local tag deleted"
    else
        print_error "Cannot continue with existing tag"
        exit 1
    fi
fi

git tag -a "v${NEW_VERSION}" -m "Release v${NEW_VERSION}"
print_success "Tag v${NEW_VERSION} created"

# Step 6: Push to GitHub
print_header "Pushing to GitHub"

read -p "Push commits and tags to GitHub? (y/N) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    # Push commits
    if [[ "$NEW_VERSION" != "$CURRENT_VERSION" ]]; then
        git push
        print_success "Commits pushed"
    fi

    # Push tag
    git push origin "v${NEW_VERSION}"
    print_success "Tag pushed"
else
    print_warning "Skipping push to GitHub"
    print_info "You can push later with:"
    print_info "  git push"
    print_info "  git push origin v${NEW_VERSION}"
fi

# Step 7: Create GitHub Release
print_header "Creating GitHub Release"

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    print_warning "GitHub CLI (gh) not found"
    print_info "Install it from: https://cli.github.com/"
    print_info ""
    print_info "To create the release manually:"
    print_info "  1. Go to: https://github.com/YOUR_USERNAME/lava-flow-jrayc/releases/new"
    print_info "  2. Tag: v${NEW_VERSION}"
    print_info "  3. Upload: bundle/lava-flow-jrayc.zip and bundle/module.json"
    print_info "  4. Mark as 'Set as the latest release'"
    exit 0
fi

# Check if user is authenticated with gh
if ! gh auth status &> /dev/null; then
    print_warning "Not authenticated with GitHub CLI"
    print_info "Run: gh auth login"
    exit 1
fi

read -p "Create GitHub release now? (y/N) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    print_info "Skipping GitHub release creation"
    print_info "You can create it later with:"
    print_info "  gh release create v${NEW_VERSION} bundle/lava-flow-jrayc.zip bundle/module.json --title \"Release v${NEW_VERSION}\""
    exit 0
fi

# Ask for release notes
echo
print_info "Enter release notes (or press Ctrl+D when done):"
echo "---"
RELEASE_NOTES=$(cat)

if [[ -z "$RELEASE_NOTES" ]]; then
    RELEASE_NOTES="Release v${NEW_VERSION}"
fi

# Create the release
print_info "Creating GitHub release..."

gh release create "v${NEW_VERSION}" \
    bundle/lava-flow-jrayc.zip \
    bundle/module.json \
    --title "Release v${NEW_VERSION}" \
    --notes "$RELEASE_NOTES"

print_success "GitHub release created!"

# Step 8: Summary
print_header "Release Complete! 🎉"

echo
print_success "Version: v${NEW_VERSION}"
print_success "Tag: v${NEW_VERSION}"
print_success "Files uploaded: lava-flow-jrayc.zip, module.json"
echo

# Get the repository URL
REPO_URL=$(git config --get remote.origin.url | sed 's/\.git$//')
if [[ $REPO_URL == git@github.com:* ]]; then
    REPO_URL=$(echo $REPO_URL | sed 's|git@github.com:|https://github.com/|')
fi

print_info "Release URL: ${REPO_URL}/releases/tag/v${NEW_VERSION}"
echo

print_info "Manifest URL for Foundry:"
echo "  ${REPO_URL}/releases/latest/download/module.json"
echo

print_info "Next steps:"
echo "  1. Test the manifest URL in Foundry VTT"
echo "  2. Share the release on Discord/Reddit"
echo "  3. Update any documentation"
echo
