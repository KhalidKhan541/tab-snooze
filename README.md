# tab-snooze

Chrome extension for enhanced browsing experience.

## Features

- Feature 1
- Feature 2
- Feature 3

## Installation

### Developer Mode
1. Clone this repository
2. Open Chrome and navigate to chrome://extensions/
3. Enable **Developer mode** (top right)
4. Click **Load unpacked**
5. Select the extension directory

## Usage

Click the extension icon to get started.

## Architecture

`
tab-snooze/
├── manifest.json          # Extension manifest (V3)
├── background.js          # Service worker
├── popup.html/js/css      # Extension popup UI
├── content.js/css         # Content script
├── tests/                 # Unit tests
├── .github/workflows/     # CI/CD pipelines
└── icons/                 # Extension icons
`

## Development

### Prerequisites
- Node.js 18+
- npm 9+

### Setup
`ash
npm install
`

### Available Scripts
`ash
npm test              # Run tests with coverage
npm run lint          # Run ESLint
npm run format        # Format with Prettier
`

## CI/CD Pipeline

GitHub Actions for continuous integration:
1. **Lint & Test** (Node 18 & 20)
2. **Build**
3. **Security Audit**
4. **Manifest Validation**

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md)

## Security

See [SECURITY.md](SECURITY.md)

## License

MIT License - see [LICENSE](LICENSE)

## Changelog

See [CHANGELOG.md](CHANGELOG.md)
