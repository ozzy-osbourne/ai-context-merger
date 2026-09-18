# Support & Contributing

Thank you for using and supporting **AI Context Merger**!

## Where can I report a problem or request a feature?

Please use our [GitHub Issue Tracker](https://github.com/ozzy-osbourne/ai-context-merger/issues).

Before opening an issue:

1. **Check existing issues** to see if the problem or feature has already been discussed.
2. **Be specific:** Describe what you expected to happen versus what actually happened.
3. **Include reproduction steps:** List exact steps, file types, or settings that cause the issue.
4. **Environment details:** Include your VS Code version and operating system (Windows, macOS, Linux).

---

## How can I contribute?

Contributions, bug fixes, and suggestions are always welcome!

1. Fork the repository: [ozzy-osbourne/ai-context-merger](https://github.com/ozzy-osbourne/ai-context-merger).
2. Clone your fork locally:
   ```bash
   git clone https://github.com/<your-username>/ai-context-merger.git
   cd ai-context-merger
   ```
3. Create a feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
4. Install dependencies:
   ```bash
   npm install
   ```
5. Make your changes and test them locally (press `F5` in VS Code to launch the Extension Development Host).
6. Validate your code before pushing:
   ```bash
   npm run check-types
   npm run lint
   npm test
   ```
   *Ensure all type checks, linter rules, and unit tests pass.*
7. Commit and push your changes:
   ```bash
   git add .
   git commit -m "feat: add support for custom presets export"
   git push origin feature/your-feature-name
   ```
8. Open a Pull Request against the `main` branch of [ozzy-osbourne/ai-context-merger](https://github.com/ozzy-osbourne/ai-context-merger).

---

## License

By contributing code to **AI Context Merger**, you agree that your contributions will be licensed under the project's [MIT License](LICENSE).