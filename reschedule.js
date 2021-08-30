const puppeteer = require("puppeteer")
const fs = require("fs")

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

async function getFirstAvailableAppointment(page) {
    const finalResponse = await page.waitForResponse(
        (response) =>
            response.url() ===
            "https://nswhvam.health.nsw.gov.au/api/sn_vaccine_sm/appointment/availability" &&
            response.status() === 200
    )
    const availabilityResponse = await finalResponse.json()
    return availabilityResponse.result.data
        .find(d => d.noOfSlots > 0 && d.available)
}

async function getFirstAppointmentButton(container) {
    return container.$(".btn.appointmentSlot")
}

async function submit(page) {
    const button = await page.$("#submitBtn")
    await button.click()
    await ringBell(page)
}

async function ringBell(page) {
    await page.evaluate(async () => {
        const audio = new Audio(
            "https://freesound.org/data/previews/66/66136_606715-lq.mp3"
        )

        async function notify() {
            while (true) {
                await audio.play()
            }
        }

        await notify()
    })
}

async function tryToGetAppointmentFromCalendar(secondDoseCalendar, page) {
    const buttonsDays = await secondDoseCalendar.$$(
        'button[ng-if="day"]:not([disabled])[aria-pressed="false"]'
    )
    for (const buttonDay of buttonsDays) {
        await buttonDay.click()
        const availableDose = await getFirstAvailableAppointment(page)
        if (availableDose) {
            return availableDose
        }
    }
}

async function selectLocationAndSite(page, location) {
    try{
        const locationDropdown = await page.$$(".vm-form-field")
        const cityFormField = locationDropdown[1]

        await cityFormField.click() //click to the form

        await page.select("select[id='city_c44edd6adbc8f01099e4fde1f39619d1'", `string:${location}`)

        const siteSelectOptions = await page.$$("select[id='preferred_center_c44edd6adbc8f01099e4fde1f39619d1'] option")
        if(siteSelectOptions.length > 1) {  //the first option is -- None --
            const firstSiteOption = await page.evaluate(option => option.value, siteSelectOptions[1])
            await page.select("select[id='preferred_center_c44edd6adbc8f01099e4fde1f39619d1']", firstSiteOption)
            return true
        }
        return false

    } catch (e){
        if (e instanceof puppeteer.errors.TimeoutError) {
            console.log(`Sleeping on timeout for ${SLEEP_TIME_ON_TIMEOUT}`)
            await sleep(SLEEP_TIME_ON_TIMEOUT)
        }
        console.log(`Failed to check location ${location} ${e}`)
        return false
    }
}

async function selectSecondDoseLocationAndSite(page, location) {
    try{
        const locationDropdown = await page.$$(".vm-form-field")
        const cityFormField = locationDropdown[5]

        await cityFormField.click() //click to the form
        await sleep(200)   //takes a bit time till the selects render

        await page.select("select[id='city_805ed1aadbc8f01099e4fde1f39619e8']", `string:${location}`)

        const siteSelectOptions = await page.$$("select[id='preferred_center_805ed1aadbc8f01099e4fde1f39619e8'] option")
        if(siteSelectOptions.length > 1) {  //the first option is -- None --
            const firstSiteOption = await page.evaluate(option => option.value, siteSelectOptions[1])
            await page.select("select[id='preferred_center_805ed1aadbc8f01099e4fde1f39619e8']", firstSiteOption)
            return true
        }

        return false
    } catch (e){
        if (e instanceof puppeteer.errors.TimeoutError) {
            console.log(`Sleeping on timeout for ${SLEEP_TIME_ON_TIMEOUT}`)
            await sleep(SLEEP_TIME_ON_TIMEOUT)
        }
        console.log(`Failed to check second dose location ${location} ${e}`)
        return false
    }
}

const SLEEP_TIME_ON_TIMEOUT = 5000;

async function searchAllLocations(page, bookFrom, bookTo, locations) {
    for(const location of locations) {
        const isLocationAvailable = await selectLocationAndSite(page, location);
        if(isLocationAvailable) {
            const appointmentFound = await findAppointment(page, bookFrom, bookTo, location, locations)
            if (appointmentFound) {
                return true
            }
        }
    }
    return false
}

async function findSecondDoseAppointment(page) {
    let secondDose = await getFirstAvailableAppointment(page)
    const appointmentContainers = await page.$$(
        ".appointmentContentContainer"
    )
    const secondDoseAppointmentContainer = appointmentContainers[1]
    if (secondDose) {
        const secondButton = await getFirstAppointmentButton(
            secondDoseAppointmentContainer
        )
        await secondButton.click()
        await submit(page)
        return true
    } else {
        const calendarContainers = await page.$$(".calendarContainer")
        const secondDoseCalendar = calendarContainers[1]
        secondDose = await tryToGetAppointmentFromCalendar(
            secondDoseCalendar,
            page
        )
        if (secondDose) {
            const secondButton = await getFirstAppointmentButton(
                secondDoseAppointmentContainer
            )
            await secondButton.click()
            await submit(page)
            return true
        }
    }
    return false
}

async function findAppointment(page, bookFrom, bookTo, preferredLocation, locations){
    const firstAppointment = await getFirstAvailableAppointment(page)

    if (!firstAppointment) {
        return false
    }
    const startDate = new Date(firstAppointment.start_date)

    if (startDate < bookFrom || startDate > bookTo) {
        return false
    }

    const appointmentButton = await getFirstAppointmentButton(page)
    await appointmentButton.click()

    //check the same location for the second dose first
    let secondDoseBooked = await findSecondDoseAppointment(page);
    if(secondDoseBooked){
        return true
    }

    const isLocationAvailable = await selectSecondDoseLocationAndSite(page, preferredLocation);

    if(isLocationAvailable) {
        let secondDoseBooked = await findSecondDoseAppointment(page);

        if(secondDoseBooked){
            return true
        }

        //try other locations
        const remainingLocations = locations.filter(location => location !== preferredLocation);
        for(const location of remainingLocations){
            const isLocationAvailable = await selectSecondDoseLocationAndSite(page, preferredLocation);

            if(isLocationAvailable) {
                secondDoseBooked = await findSecondDoseAppointment(page);

                if(secondDoseBooked){
                    return true
                }
            }
        }
    }
}

async function schedule(bookAfter, bookBefore, taskId, nswhvamCookiePath, locations) {
    const browser = await puppeteer.launch({
        headless: false,
        ignoreDefaultArgs: ["--mute-audio"],
        args: ["--autoplay-policy=no-user-gesture-required"],
        defaultViewport: null,
        slowMo: 200,
    })
    const rescheduleUrl = `https://nswhvam.health.nsw.gov.au/vam?id=reschedule_vaccination&taskId=${taskId}`

    const page = await browser.newPage()
    const cookies = JSON.parse(fs.readFileSync(nswhvamCookiePath, "utf-8"))
    await page.setCookie(...cookies)
    await page.goto(rescheduleUrl)

    const bookAfterDate = new Date(bookAfter)
    const bookBeforeDate = new Date(bookBefore)

    let appointmentFound
    do {
        try {
            appointmentFound = await searchAllLocations(page, bookAfterDate, bookBeforeDate, locations)
            await sleep(500)
            await page.reload()
        } catch (e) {
            if (e instanceof puppeteer.errors.TimeoutError) {
                console.log(`Sleeping on timeout for ${SLEEP_TIME_ON_TIMEOUT}`)
                await sleep(SLEEP_TIME_ON_TIMEOUT)
            } else {
                throw e
            }
        }
    } while (!appointmentFound)

    await sleep(30000)
    await browser.close()
}

const availableCloseLocations = ['Sydney Olympic Park', 'Macquarie Fields']
const closeLocations = ['Randwick', 'Darlinghurst', 'Sydney Olympic Park']
const allSydneyLocations = ['Randwick', 'Darlinghurst', 'Sydney Olympic Park', 'Macquarie Fields', 'Westmead', 'Penrith', 'Prairiewood', 'South Western Sydney', 'Western Sydney']

schedule('Aug 30 2021', 'Sep 14 2021', 'b8e6f0011b1e3810a74ccbb9274bcb19', './nswhvam.health.nsw.gov.au.cookies.json',
    availableCloseLocations
)
// schedule('Aug 31 2021', 'Sep 30 2021', 'cc6bf4451b9e3810a74ccbb9274bcb74', './nswhvam.health.nsw.gov.au.cookies-liz.json')
