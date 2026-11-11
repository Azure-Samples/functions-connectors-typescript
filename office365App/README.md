# Office 365 Outlook Connector Sample

Choose an independent Azure Functions app:

- [Webhook](webhook/README.md)
- [Polling](polling/README.md)

Each app has its own dependencies, source, host configuration, Bicep, and setup scripts. Run `npm ci`, `npm test`, and `azd up` from the chosen subfolder, using a distinct azd environment for each app.
