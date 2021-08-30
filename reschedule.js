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

async function tryToGetAppointmentFromCalendar(secondDosisCalendar, page) {
    const buttonsDays = await secondDosisCalendar.$$(
        'button[ng-if="day"]:not([disabled])[aria-pressed="false"]'
    )
    for (const buttonDay of buttonsDays) {
        await buttonDay.click()
        const availableDosis = await getFirstAvailableAppointment(page)
        if (availableDosis) {
            return availableDosis
        }
    }
}

async function setLocation(page, location) {
    const locationDropdown = await page.$$(".vm-form-field")
    const cityFormField = locationDropdown[5]
    await cityFormField.click() //click to the form

    await page.select("select[id='city_805ed1aadbc8f01099e4fde1f39619e8']", `string:${location}`)

    const siteSelectOptions = await page.$$("select[id='preferred_center_805ed1aadbc8f01099e4fde1f39619e8'] option")
    if(siteSelectOptions.length > 1) {  //the first option is -- None --
        const firstSiteOption = await page.evaluate(option => option.value, siteSelectOptions[1])
        await page.select("select[id='preferred_center_805ed1aadbc8f01099e4fde1f39619e8']", firstSiteOption)
        return true
    }

    return false
}

async function findAtLocation(page, bookFrom, bookTo, location) {
    // await setLocation(page, location)
    return await findAppointment(page, bookFrom, bookTo, location)
}

async function findSecondDosisAppointment(page) {
    let secondDosis = await getFirstAvailableAppointment(page)
    const appointmentContainers = await page.$$(
        ".appointmentContentContainer"
    )
    const secondDosisAppointmentContainer = appointmentContainers[1]
    if (secondDosis) {
        const secondButton = await getFirstAppointmentButton(
            secondDosisAppointmentContainer
        )
        await secondButton.click()
        await submit(page)
        return true
    } else {
        const calendarContainers = await page.$$(".calendarContainer")
        const secondDosisCalendar = calendarContainers[1]
        secondDosis = await tryToGetAppointmentFromCalendar(
            secondDosisCalendar,
            page
        )
        if (secondDosis) {
            const secondButton = await getFirstAppointmentButton(
                secondDosisAppointmentContainer
            )
            await secondButton.click()
            await submit(page)
            return true
        }
        let secondPageButton = await secondDosisCalendar.$(
            "button#goNext:not([disabled])"
        )
        secondPageButton =
            secondPageButton ||
            (await secondDosisCalendar.$(
                "button#goPrevious:not([disabled])"
            ))

        if (secondPageButton) {
            await secondPageButton.click()
            secondDosis = await getFirstAvailableAppointment(page)
            if (secondDosis) {
                const secondButton = await getFirstAppointmentButton(
                    secondDosisAppointmentContainer
                )
                await secondButton.click()
                await submit(page)
                return true
            }
            secondDosis = await tryToGetAppointmentFromCalendar(
                secondDosisCalendar,
                page
            )
            if (secondDosis) {
                const secondButton = await getFirstAppointmentButton(
                    secondDosisAppointmentContainer
                )
                await secondButton.click()
                await submit(page)
                return true
            }
        }
    }
}

async function findAppointment(page, bookFrom, bookTo, location){
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

    await setLocation(page, location)

    //check the same location for the second dosis first
    let secondDosisBooked = await findSecondDosisAppointment(page);
    if(secondDosisBooked){
        return true
    }
}

async function schedule(bookAfter, bookBefore, taskId, nswhvamCookiePath, location) {
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
            appointmentFound = await findAtLocation(page, bookAfterDate, bookBeforeDate, location)
            await sleep(5000)
            await page.reload()
        } catch (e) {
            if (e instanceof puppeteer.errors.TimeoutError) {
                await sleep(30 * 60 * 1000)
            } else {
                throw e
            }
        }
    } while (!appointmentFound)

    await sleep(30000)
    await browser.close()
}

const closeLocations = ['Randwick', 'Darlinghurst', 'Sydney Olympic Park']
const allSydneyLocations = ['Randwick', 'Darlinghurst', 'Sydney Olympic Park', 'Macquarie Fields', 'Westmead', 'Penrith', 'Prairiewood', 'South Western Sydney', 'Western Sydney']

schedule('Aug 30 2021', 'Sep 14 2021', 'b8e6f0011b1e3810a74ccbb9274bcb19', './nswhvam.health.nsw.gov.au.cookies.json',
    'Sydney Olympic Park'
)
// schedule('Aug 31 2021', 'Sep 30 2021', 'cc6bf4451b9e3810a74ccbb9274bcb74', './nswhvam.health.nsw.gov.au.cookies-liz.json')
