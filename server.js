#!/usr/bin/env node
'use strict'
const express = require('express')
const helmet = require('helmet')
const authenticate = require('./src/authenticate')
const params = require('./src/params')
const proxy = require('./src/proxy')

const app = express()
const PORT = process.env.PORT || 8080


app.enable('trust proxy')
app.get('/', authenticate, params, proxy)
app.get('/favicon.ico', (req, res) => res.status(204).end())
app.listen(PORT, () => {
    console.log(`Listening on ${PORT}`)
    // For additional setup like initializing performance monitoring agents, add here.
})
