/**
 * Script de teste para verificar dados retornados pela API Portal Voalle
 * Endpoint: /api/people/{person_id}/authentications
 * 
 * Uso: npx tsx server/test-voalle-connections.ts
 */

import { db } from "./db";
import { erpIntegrations } from "@shared/schema";
import { eq } from "drizzle-orm";

interface VoalleProviderConfig {
  portalApiUrl?: string;
  portalVerifyToken?: string;
  portalClientId?: string;
  portalClientSecret?: string;
  portalUsername?: string;
  portalPassword?: string;
}

async function testVoalleConnections() {
  // Credenciais do teste fornecidas pelo usuário
  const testUser = "05953099000160";
  const testPassword = "05953099000160";
  
  console.log("=== Teste API Portal Voalle - Conexões ===\n");
  
  // Buscar integração Voalle ativa
  const [integration] = await db.select().from(erpIntegrations)
    .where(eq(erpIntegrations.provider, "voalle"));
  
  if (!integration) {
    console.error("Integração Voalle não encontrada!");
    process.exit(1);
  }
  
  // Credenciais do Portal API fornecidas pelo usuário
  const portalApiUrl = "http://api.marvitel.com.br";
  const portalVerifyToken = "TWpNMU9EYzVaakk1T0dSaU1USmxaalprWldFd00ySTFZV1JsTTJRMFptUT06V2tkS2JHSllRWGROUkUxNlRrRTlQUT09OlpUaGtNak0xWWprMFl6bGlORE5tWkRnM01EbGtNalkyWXpBeE1HTTNNR1U9";
  const portalClientId = "9_25i5oho5vo80c4808oo44ksc448o8c0sso08g40g8o8400csss";
  const portalClientSecret = "3u3j2i8op4w0kw4g0k8c4o0408cs0g4sw4c8g8s8gg4koo8c0w";
  
  console.log(`Portal URL: ${portalApiUrl}`);
  console.log(`Usuário de teste: ${testUser}\n`);
  
  try {
    // Passo 1: Autenticar no Portal
    console.log("1. Autenticando no Portal...");
    
    let baseUrl = portalApiUrl.trim();
    if (baseUrl.endsWith("/")) {
      baseUrl = baseUrl.slice(0, -1);
    }
    
    const authUrl = `${baseUrl}/portal_authentication?verify_token=${encodeURIComponent(portalVerifyToken)}&client_id=${encodeURIComponent(portalClientId)}&client_secret=${encodeURIComponent(portalClientSecret)}&grant_type=client_credentials&username=${encodeURIComponent(testUser)}&password=${encodeURIComponent(testPassword)}`;
    
    const authResponse = await fetch(authUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    
    if (!authResponse.ok) {
      const errorText = await authResponse.text();
      console.error(`Erro na autenticação: ${authResponse.status} - ${errorText}`);
      process.exit(1);
    }
    
    const authData = await authResponse.json() as { 
      access_token: string; 
      person?: { id: number; name: string };
      validation?: { person?: { id: number; name: string } };
    };
    
    const accessToken = authData.access_token;
    const personId = authData.validation?.person?.id || authData.person?.id;
    const personName = authData.validation?.person?.name || authData.person?.name;
    
    console.log(`   Autenticado com sucesso!`);
    console.log(`   Person ID: ${personId}`);
    console.log(`   Nome: ${personName}\n`);
    
    if (!personId) {
      console.error("Não foi possível obter o person_id da autenticação");
      console.log("Resposta completa da autenticação:", JSON.stringify(authData, null, 2));
      process.exit(1);
    }
    
    // Passo 2: Buscar conexões
    console.log("2. Buscando conexões...");
    
    const connectionsUrl = `${baseUrl}/api/people/${personId}/authentications`;
    console.log(`   URL: ${connectionsUrl}`);
    
    const connectionsResponse = await fetch(connectionsUrl, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Verify-Token": portalVerifyToken,
      },
    });
    
    if (!connectionsResponse.ok) {
      const errorText = await connectionsResponse.text();
      console.error(`Erro ao buscar conexões: ${connectionsResponse.status} - ${errorText}`);
      process.exit(1);
    }
    
    const connectionsData = await connectionsResponse.json();
    
    console.log("\n=== RESPOSTA COMPLETA DA API ===\n");
    console.log(JSON.stringify(connectionsData, null, 2));
    
    // Analisar campos úteis
    if (connectionsData.data && Array.isArray(connectionsData.data)) {
      console.log("\n=== ANÁLISE DOS CAMPOS ===\n");
      console.log(`Total de conexões: ${connectionsData.data.length}`);
      
      for (const conn of connectionsData.data) {
        console.log("\n--- Conexão ---");
        console.log(`ID: ${conn.id}`);
        console.log(`Ativo: ${conn.active}`);
        console.log(`Usuário PPPoE: ${conn.user}`);
        console.log(`Tipo IP: ${conn.ipTypeAsText} (${conn.ipType})`);
        console.log(`Tipo Equipamento: ${conn.equipmentTypeAsText}`);
        console.log(`Serial Equipamento: ${conn.equipmentSerialNumber}`);
        console.log(`Slot/Porta OLT: ${conn.slotOlt}/${conn.portOlt}`);
        
        if (conn.contract) {
          console.log(`Contrato: ${conn.contract.contract_number} - ${conn.contract.description}`);
          console.log(`Status Contrato: ${conn.contract.status}`);
        }
        
        if (conn.serviceProduct) {
          console.log(`Produto/Plano: ${conn.serviceProduct.title}`);
        }
        
        if (conn.contractServiceTag) {
          console.log(`Etiqueta: ${conn.contractServiceTag.serviceTag} - ${conn.contractServiceTag.description}`);
        }
        
        if (conn.peopleAddress) {
          const addr = conn.peopleAddress;
          console.log(`Endereço: ${addr.streetType} ${addr.street}, ${addr.number} - ${addr.neighborhood}, ${addr.city}/${addr.state}`);
        }
        
        console.log(`Coordenadas: ${conn.lat}, ${conn.lng}`);
        console.log(`Criado: ${conn.created}`);
      }
    }
    
  } catch (error) {
    console.error("Erro:", error);
    process.exit(1);
  }
  
  process.exit(0);
}

testVoalleConnections();
