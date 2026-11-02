import { app } from './app'

export { app }

app.listen(Number(process.env.PORT ?? 3001))
