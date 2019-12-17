#! /usr/bin/env node

const prompt = require('prompt')
const puppeteer = require('puppeteer')
const chalk = require('chalk')
const cliProgress = require('cli-progress')

const path = require('path')
const fs = require('fs')

const LOGIN_PAGE = 'https://hris.rminc.com/hris/hrisLogin.aspx?Act=2'
const PAYCHECKS_PAGE = 'https://hris.rminc.com/hris/Summit/Employee/Edit_PayHistory.aspx'

const userPassSchema = {
  properties: {
    username: {
      pattern: /^[a-zA-Z0-9\s\-]+$/,
      message: 'Name must be only numbers, letters, spaces, or dashes',
      required: true
    },
    password: {
      hidden: true
    }
  }
};


// MAIN LOOP
(async () => {
  const OUTPUT_FOLDER = process.argv[2]
  if (!OUTPUT_FOLDER) {
    console.log(chalk.red(`Output folder required! Usage: 'rmi-download ./folder'`))
    process.exit(1)
  }

  if (!fs.existsSync(OUTPUT_FOLDER)) {
    console.log(chalk.red(`Folder '${OUTPUT_FOLDER}' does not exist!`))
    process.exit(2)
  }

  console.log(chalk.cyan(asciify('RMI Paycheck Downloader', 1)))
  const browserPromise = browserSetup(LOGIN_PAGE)
  let browserFinished = false
  let browser, page
  try {

    prompt.start()

    // Keep trying to log in until success
    let loggedIn = false
    while (!loggedIn) {
      try {
        const answers = await getUserCredentials()
        if (!browserFinished) {
          browserResult = await browserPromise
          browser = browserResult.browser
          page = browserResult.page
          browserFinished = true
        }
        await login(page, answers.username, answers.password)
        loggedIn = true
      } catch (e) {
        if (e.message.indexOf('Invalid') !== -1) {
          console.log(chalk.red(e.message + ', please try again'))
        } else {
          throw e
        }
      }
    }
    console.log(chalk.cyan('Logged in!'))
    const paychecks = await getPaychecks(page)

    console.log(chalk.cyan(`Downloading ${paychecks.length} paychecks to ${OUTPUT_FOLDER}...`))
    const progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic)
    progress.start(paychecks.length, 0)
    for (let i=0; i<paychecks.length; i++) {
        await downloadPaycheck(page, paychecks[i], OUTPUT_FOLDER)
        progress.update(i + 1)
    }
    progress.stop()
    console.log(chalk.green(`Done!`))

  } catch (e) {
    browser && browser.close()
    throw e
  }
  browser && browser.close()

})().catch(err => {
  // Swallow cancelation errors
  if (err && err.message === 'canceled') return
  console.error(err)
})


// HELPER FUNCTIONS

/**
 * Ask the user for credentials
 * @return {Promise} Promise that resulves with {name, password}
 */
function getUserCredentials() {
  return new Promise(function (resolve, reject) {
    prompt.get(userPassSchema, function (err, result) {
      if (err) return reject(err)
      resolve(result)
    })   
  })
}


/**
 * Sets up the browser and browsers to a url
 * @param  {string} url Initial url to browse to
 * @return {Object}     Object containing { browser, page } Puppeteer objects
 */
async function browserSetup(url) {
  console.log(chalk.grey('Opening browser...'))
  const browser = await puppeteer.launch()
  const page = await browser.newPage()
  page.setViewport({ width: 1200, height: 1200})
  await page.goto(LOGIN_PAGE)
  return { browser, page }
}


/**
 * Attempts to log in using the provided credentials
 * @param  {Object} page     Puppeteer page object navigated to the login page
 * @param  {string} username Username to use when logging in
 * @param  {string} password Password to use when logging in
 * @return {void}
 */
async function login(page, username, password) {
  await page.click('#txtEeUserName')
  await page.keyboard.type(username)
  await page.click('#txtEePassword')
  await page.keyboard.type(password)
  console.log(chalk.grey('Logging in...'))
  const navPromise = page.waitForNavigation()
  await page.click('#btnee')
  await navPromise
  if (page.url() === LOGIN_PAGE) {
    const loginError = await page.evaluate(() => {
      let errorMessage = document.getElementById('lblEeMsg')
      if (errorMessage && errorMessage.innerText.indexOf('Invalid Login Information') !== -1) {
        return errorMessage.innerText
      }
    })
    if (loginError) {
      throw new Error(loginError)
    }
  }
}


/**
 * Get the list of paychecks to be downloaded
 * @param  {Object} page     Puppeteer page object
 * @return {Array}           Array with date, value, and text from each paycheck option
 */
async function getPaychecks(page) {
    console.log(chalk.grey('Waiting for paycheck list...'))
    await page.goto(PAYCHECKS_PAGE)
    const paychecks = await page.evaluate(() => {
        const options = document.getElementById('drp_CheckDate').options
        const optionMap = []
        for (let i=0; i<options.length; i++) {
            const dateMatch = /(\d\d)\/(\d\d)\/(\d\d\d\d)/.exec(options[i].innerText)
            optionMap.push({
                date: dateMatch && dateMatch.length === 4 ? `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}` : 'unknown',
                value: options[i].value,
                text: options[i].innerText,
            })
        }
        return optionMap
    })
    return paychecks.filter(paycheck => paycheck.value)
}

/**
 * Download a specific paycheck as a PDF
 * @param  {Object} page     Puppeteer page object
 * @param  {Object} paycheck Object with information about the paycheck to be downloaded
 * @param  {string} folder   Folder the pdfs should be downloaded to
 * @return {void}
 */
async function downloadPaycheck(page, paycheck, folder) {
    const navPromise = page.waitForNavigation()
    await page.evaluate(paycheck => {
        document.getElementById('drp_CheckDate').value = paycheck.value
        document.getElementById('btn_showchecks').click()
    }, paycheck)
    await navPromise
    await page.pdf({path: path.join(folder, 'Lendio Paycheck - ' + paycheck.date + '.pdf')})
}



/**
 * Duplicates a character a number of times
 * @param  {string} char   Character or string to duplicate
 * @param  {number} length Number of times to duplicate the input string
 * @return {string}        Character duplicated n number of times
 */
function repeat(char, length) {
  let str = ''
  for (let i=0; i<length; i++) {
    str += char
  }
  return str
}


/**
 * Wrap a string in nice, neat rows of asterisks
 * @param  {string} string  Content to asciify
 * @param  {number} padding Multiplier for how much padding to use
 * @return {string}         Multi-line string with padding and a border added
 */
function asciify(string, padding) {
  let horizontalStretch = 5
  let char = '*'
  let border = repeat(char, string.length + padding * horizontalStretch * 2 + 2)
  let gap = char + repeat(' ', string.length + padding * horizontalStretch * 2) + char
  let result = []
  result.push(border)
  for (let i=0; i<padding; i++) {
    result.push(gap)
  }
  result.push(char + repeat(' ', padding * horizontalStretch) + string + repeat(' ', padding * horizontalStretch) + char)
  for (let i=0; i<padding; i++) {
    result.push(gap)
  }
  result.push(border)
  return result.join('\n')
}