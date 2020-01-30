/*
    The Arweave World Event Logger.
    
    A bot for extracting and storing links and messages from Discord discussions.
*/

const Discord = require('discord.js')
const Arweave = require('arweave/node')
const axios = require('axios')
const fs = require('fs')
const argv = require('yargs').argv
const client = new Discord.Client()
const auth = require('./auth.json')

// Set Arweave parameters from commandline or defaults.
const arweave_port = argv.arweavePort ? argv.arweavePort : 443
const arweave_host = argv.arweaveHost ? argv.arweaveHost : 'arweave.net'
const arweave_protocol = argv.arweaveProtocol ? argv.arweaveProtocol : 'https'

if(!argv.walletFile) {
    console.log("ERROR: Please specify a wallet file to load using argument " +
        "'--wallet-file <PATH>'.")
    process.exit()
}

const raw_wallet = fs.readFileSync(argv.walletFile)
const wallet = JSON.parse(raw_wallet)

const arweave = Arweave.init({
    host: arweave_host,
    port: arweave_port,
    protocol: arweave_protocol
})

client.on('ready', async function() {
    let net_info = await arweave.network.getInfo()
    const address = await arweave.wallets.jwkToAddress(wallet)
    let balance =
        arweave.ar.winstonToAr(await arweave.wallets.getBalance(address))
    console.log(`Connected to Discord and logged in as ${client.user.tag}!`)
    console.log(`Synchronised with Arweave at height ${net_info.height}.`)
    console.log(`...using wallet ${address} (balance: ${balance} AR).`)
});

client.login(auth.token);

client.on('message', async msg => {
    // Generate transaction for Discord message.
	let tx = await arweave.createTransaction({ data: msg.content }, wallet)
    tx.addTag("app-name", "AWEL")
    tx.addTag("type", "message")
    tx.addTag("user-id", msg.author.id)
    tx.addTag("username", msg.author.username)
    tx.addTag("server-id", msg.guild.id)
    tx.addTag("server-name", msg.guild.name)
    tx.addTag("channel-id", msg.channel.id)
    tx.addTag("channel-name", msg.channel.name)

    let id = await sendTX(tx)

    let links =
        msg.content.match(
            /(https?:\/\/(?:www\.|(?!www))[^\s\.]+\.[^\s]{2,}|www\.[^\s]+\.[^\s]{2,})/gi
        )

    for(i in links)
        archiveLink(links[i], id)
});

async function archiveLink(link, txid) {
    axios.get(link)
    .then(async res => {
        console.log(`Got link ${link} (trigger message: ${txid}, status: ${res.statusText}, size: ${res.data.length}b).`)
        let tx = await arweave.createTransaction({ data: res.data }, wallet)
        tx.addTag("app-name", "AWEL")
        tx.addTag("type", "page")
        tx.addTag("trigger-message", txid)
        tx.addTag("Content-Type", "text/html")
        tx.addTag("page:url", link)
        tx.addTag("page:timestamp", Math.floor(Date.now() / 1000).toString())
        sendTX(tx)
    })
    .catch(error => {
        console.log(`Failed to archive link ${link} with error: ${error}.`);
    });
}

async function sendTX(tx) {
    // Dispatch transaction to network and report.
    await arweave.transactions.sign(tx, wallet)
    const response = await arweave.transactions.post(tx)

    // Report.
    let fee = arweave.ar.winstonToAr(tx.reward)
    console.log(
        `Submitting TX ${tx.id} (${fee} AR) to Arweave received response ${response.statusText}.`
    )
    return tx.id
}