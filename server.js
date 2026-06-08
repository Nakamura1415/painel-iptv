const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");

const XLSX = require("xlsx");
const multer = require("multer");

const { MercadoPagoConfig, Payment, Preference } = require("mercadopago");

const app = express();

app.use(express.static(__dirname + "/gm-ultra-connect"));

app.use(express.urlencoded({ extended: true }));

app.use(express.json());
app.use(cors());

const upload = multer({ dest: "uploads/" });

const client = new MercadoPagoConfig({
accessToken: "APP_USR-6257102166038584-052718-13bec40e6d81579d8ca6a2bc9c1f52c7-3257151693"
});

const payment = new Payment(client);

const preference = new Preference(client);

const PORT = process.env.PORT || 3000;

// conexão com banco
mongoose.connect("mongodb://mongo:wOCwzpzGcCdqKuRSLjokaUUzwMMOAfJP@mongodb.railway.internal:27017", {
  serverSelectionTimeoutMS: 30000
})
.then(() => {
  console.log("MongoDB conectado");

  app.listen(PORT, () => {
    console.log("Servidor rodando na porta " + PORT);
  });

})
.catch((err) => {
  console.error("ERRO MONGO:", err);
});


// modelo cliente
const Cliente = mongoose.model("Cliente", {
  nome: String,
  telefone: String,
  login: String,
  senha: String,
  status: String,
  vencimento: Date,
  ultimoPagamento: Date,
});

const Pagamento = mongoose.model("Pagamento", {
  clienteId: String,
  nome: String,
  telefone: String,
  plano: String,
  valor: Number,
  status: String,
  mercadoPagoId: String,
  criadoEm: {
    type: Date,
    default: Date.now
  }
});

// rota criar cliente
app.post("/clientes", async (req, res) => {
  const cliente = new Cliente(req.body);
  await cliente.save();
  res.send("Cliente criado com sucesso");
});

// rota listar clientes
app.get("/clientes", async (req, res) => {
  const clientes = await Cliente.find();
  res.json(clientes);
});

app.put("/clientes/:id/renovar", async (req, res) => {
  const novaData = new Date();

  novaData.setDate(novaData.getDate() + 30);

  await Cliente.findByIdAndUpdate(req.params.id, {
    vencimento: novaData,
    status: "ativo"
  });

  res.send("Cliente renovado");
});

app.put("/clientes/:id", async (req, res) => {

await Cliente.findByIdAndUpdate(
req.params.id,
req.body
);

res.send("Cliente atualizado");

});

app.delete("/clientes/:id", async (req, res) => {

await Cliente.findByIdAndDelete(req.params.id);

res.send("Cliente deletado");

});

app.get("/cliente/telefone/:telefone", async (req, res) => {

const cliente = await Cliente.findOne({
telefone: req.params.telefone
});

if (cliente) {

res.json({
existe: true,
cliente: cliente
});

} else {

res.json({
existe: false
});

}

});

// iniciar servidor

function converterData(dataTexto) {

if (!dataTexto) return new Date();

if (dataTexto instanceof Date) return dataTexto;

const partes = String(dataTexto).split(" ")[0].split("/");

if (partes.length === 3) {
const dia = partes[0];
const mes = partes[1];
const ano = partes[2];

return new Date(`${ano}-${mes}-${dia}`);
}

return new Date(dataTexto);

}

app.post("/importar", upload.single("arquivo"), async (req, res) => {

const workbook = XLSX.readFile(req.file.path);

const sheet = workbook.Sheets[workbook.SheetNames[0]];

const dados = XLSX.utils.sheet_to_json(sheet);

for (const item of dados) {

await Cliente.create({

nome: item["Notas"] || "Cliente sem nome",

telefone: String(item["Número"] || "").replace(".0", ""),

login: item["Usuário"] || "",

senha: item["Senha"] || "",

status: item["Status"] || "",

vencimento: converterData(item["Vencimento"])

});

}

res.send("Clientes importados com sucesso");

});

app.use(express.static(__dirname));

app.get("/clientes-duplicados", async (req, res) => {

const clientes = await Cliente.find();

const loginsVistos = [];

for (const cliente of clientes) {

if (loginsVistos.includes(cliente.login)) {

await Cliente.findByIdAndDelete(cliente._id);

} else {

loginsVistos.push(cliente.login);

}

}

res.send("Duplicados removidos");

});

app.post("/criar-pix", async (req, res) => {

try {

const pagamento = await payment.create({
body: {

transaction_amount: Number(req.body.valor),

description: req.body.descricao,

payment_method_id: "pix",

payer: {

email: "cliente@email.com"

}

}
});

res.json({

pix: pagamento.point_of_interaction.transaction_data.qr_code,

qr_code: pagamento.point_of_interaction.transaction_data.qr_code_base64

});

} catch (erro) {

console.log(erro);

res.status(500).send("Erro ao gerar PIX");

}


});

app.get("/webhook", (req, res) => {
  res.send("Webhook GM ULTRA CONNECT online");
});

app.post("/webhook", async (req, res) => {

  console.log("WEBHOOK RECEBIDO!");

  try {

    const paymentId = req.body?.data?.id;

    console.log("PAYMENT ID:", paymentId);

    if (paymentId) {

      const pagamentoInfo = await payment.get({
        id: paymentId
      });

      console.log("STATUS:", pagamentoInfo.status);

      if (pagamentoInfo.status === "approved") {

      
  const telefoneCliente = pagamentoInfo.external_reference;

  const cliente = await Cliente.findOne({
    telefone: telefoneCliente
  });

  if (cliente) {

    const hoje = new Date();

    const vencimentoAtual = cliente.vencimento
      ? new Date(cliente.vencimento)
      : hoje;

    const baseRenovacao =
      vencimentoAtual > hoje
        ? vencimentoAtual
        : hoje;

    baseRenovacao.setDate(
      baseRenovacao.getDate() + 30
    );

    cliente.vencimento = baseRenovacao;

    cliente.status = "ativo";

    cliente.ultimoPagamento = new Date();

    await cliente.save();

    console.log(
      "CLIENTE RENOVADO:",
      cliente.nome
    );

  } else {

    console.log(
      "CLIENTE NÃO ENCONTRADO"
    );

  }

  }
}
    res.sendStatus(200);

} catch (erro) {
console.log("ERRO WEBHOOK:");
console.log(erro.message || erro);

res.sendStatus(200);
}
});

app.post("/criar-checkout", async (req, res) => {

  try {

    const resultado = await preference.create({
      body: {
        items: [
          {
            title: req.body.descricao,
            quantity: 1,
            unit_price: Number(req.body.valor),
            currency_id: "BRL"
          }
        ],

        external_reference: req.body.telefone,
        
        payment_methods: {
          installments: 12
        },
notification_url: "https://drives-need-effort-likewise.trycloudflare.com/webhook",
     }
    });

    res.json({
      link: resultado.init_point
    });

  } catch (erro) {
    console.log(erro);
    res.status(500).send("Erro ao criar checkout");
  }

});

app.use(express.static(__dirname + "/gm-ultra-connect"));

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/gm-ultra-connect/index.html");
});

