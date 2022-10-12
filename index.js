require('dotenv').config();
const puppeteer = require('puppeteer');
const axios = require('axios');
const nodeCron = require('node-cron');


async function scrapeSpellingBee(){

    // "Be spelling" api url
    const { BS_API_URL } = process.env;

    const { log, error } = console;

    log('Launching browser...');
    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    const SPELLING_BEE_URL = 'https://www.nytimes.com/puzzles/spelling-bee';

    log(`Navigating to ${SPELLING_BEE_URL}...`);
    await page.goto(SPELLING_BEE_URL);

    /* 
     * Using <Element>.evaluate() instead of <Element>.click() because it triggers
     * HTMLElement.click() event in browser rather than scrolling to button element, 
     * moving mouse there, and then clicking. 
     * This allows us to click the "Yesterday's answers button before it's visible",
     * helping to ensure that the answers modal is ready to be parsed when we get there
    */

    //Click "Yesterday's Answers" button to open answers modal
    const yesterdayButton = await page.waitForSelector('.pz-toolbar-button__yesterday'); 
    await yesterdayButton.evaluate(b => b.click());

    // Click "Play" button to navigate to hide intro page and reveal answers modal 
    const playButton = await page.waitForSelector('.pz-moment__button.primary');
    await playButton.evaluate(b => b.click());

    // @TODOS API:
    // Do not add puzzle if letters wrong length
    // Validate every field on requestObject
    // Do not add puzzle if puzzle from date already exists


    // Wait for "Yesterday's Answers modal to be visible before parsing it for puzzle data"
    await page.waitForSelector(
        '.sb-modal-title',
        { visible: true }
    );

    log("Parsing and formatting data from 'Yesterday's Answers' modal...");

    const dateTextContent = await getElementText(page, '.sb-modal-date__yesterday');

    const date = new Date(dateTextContent)
        .toISOString()
        .substring(0, 10);

    let lettersTextContent = await getElementText(page, '.sb-modal-letters');
    lettersTextContent = lettersTextContent.toUpperCase();

    const centerLetter = lettersTextContent.slice(0, 1);
    const letters = lettersTextContent.slice(1).split('');

    // Grab all span elements with .sb-anagram class
    // There are the words/answers for the puzzle
    const wordSpans = await page.$$('.sb-anagram');

    const evaluatedWords = await Promise.all(
        wordSpans.map(async span => {
            
            const isPangram = await span.evaluate(el => el.classList.contains('pangram'));
            let textContent = await span.evaluate(el => el.textContent);

            // Capitalize first letter of each word
            textContent = textContent[0].toUpperCase() + textContent.substring(1);
            
            return {
                type: isPangram ? 'pangram' : 'word',
                value: textContent
            };
        })
    );

    const pangrams = evaluatedWords
        .filter(word => word.type === 'pangram')
        .map(word => word.value);

    const words = evaluatedWords
        .filter(word => word.type === 'word')
        .map(word => word.value);
        
   
    const requestObject = {
        date,
        centerLetter,
        letters,
        pangrams,
        words,
    };

    // Post parsed data to Be Spelling api/puzzles endpoint to add puzzle to db
    try {
        log(`Starting API post request to ${BS_API_URL}`);

        const response = await axios.post(
            `${BS_API_URL}`,
            requestObject
        );

        log(`Responded with status: ${response.status}`);
        log(`Response data: `, response.data);

    } catch (err) {
        error(
            `Error on api post request to ${BS_API_URL} `,
            `with request object: ${requestObject} `,
            err,
        );
    }

    log(`Our work here is done. Closing browser...`);
    await browser.close();
}

nodeCron.schedule('0 8 * * *', scrapeSpellingBee);

// Helpers

async function getElementText(page, selector) {
    const textContent = await page.$eval(selector, el => el.textContent);
    return textContent;
}